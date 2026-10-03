import { hash } from "zod";
import { Project } from "../models/Project.js";
import { reviseProject } from "../services/ai.js";
import { applyOperations } from "../services/diff.js";

// POST /api/projects/:id/chat
// Send a Revision Prompt And Return Updated Project

export function buildManifest(files) {
  const manifest = [];
  for (const [path, entry] of Object.entries(files)) {
    manifest.push({ path, hash: entry.hash, size: entry.content.length });
  }
  return manifest;
}

export async function chat(req, res) {
  const { prompt } = req.body;

  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "Prompt Is Required" });
    return;
  }

  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const project = await Project.findOne({
    _id: req.params.id,
    owner: req.user.userId,
  });

  if (!project) {
    return res.status(404).json({ error: "Project Not Found" });
  }

  if (project.status?.toLowerCase() !== "completed") {
    return res.status(409).json({
      error: "Project is not ready for revisions",
    });
  }

  const baseVersion = project.version;
  const revisionProject = await Project.findOneAndUpdate(
    {
      _id: project._id,
      owner: req.user.userId,
      version: baseVersion,
    },
    {
      $set: { status: "revising" },
      $push: {
        messages: { role: "user", content: prompt, timestamp: new Date() },
      },
    },
    { returnDocument: "after" },
  );

  if (!revisionProject) {
    return res.status(409).json({ error: "Project was updated concurrently" });
  }

  try {
    // Build Compact Manifest (path + hash + size) Instead of Sending All Code

    const manifest = buildManifest(revisionProject.files);

    // Including All Files Content So AI Can Do Accurate Search/Replace

    const relevantFiles = {};
    for (const [path, entry] of Object.entries(revisionProject.files)) {
      relevantFiles[path] = entry.content;
    }

    // Recent Messages For Context (Last 4 Max)

    const recentMessages = revisionProject.messages.slice(-4).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    console.log(
      `[AI] Revising Project ${revisionProject._id}: "${prompt.slice(0, 80)}..." ` +
        `(${manifest.length} files, manifest ~${JSON.stringify(manifest).length})`,
    );

    // Call AI With Manifest + Relevant Files
    const result = await reviseProject(
      prompt,
      manifest,
      relevantFiles,
      recentMessages,
    );

    console.log(
      `[AI] Got ${result.operations.length} Operation: ${result.description}`,
    );

    // Apply Operations To File Map
    const {
      files: updatedFiles,
      applied,
      errors,
    } = applyOperations(revisionProject.files, result.operations);

    if (errors.length > 0) {
      console.warn(`[Diff] Errors Applying Operations`, errors);
    }

    const updatedProject = await Project.findOneAndUpdate(
      {
        _id: project._id,
        owner: req.user.userId,
        version: baseVersion,
      },
      {
        $set: { files: updatedFiles, status: "completed" },
        $push: {
          messages: {
            role: "assistant",
            content:
              result.description +
              (errors.length > 0
                ? `\n\n Some Operations Failed: ${errors.join(", ")}`
                : ""),
          },
        },
        ...(applied.length > 0 ? { $inc: { version: 1 } } : {}),
      },
      { returnDocument: "after" },
    );

    if (!updatedProject) {
      await Project.updateOne(
        { _id: project._id, owner: req.user.userId, status: "revising" },
        { $set: { status: "completed" } },
      );
      return res
        .status(409)
        .json({ error: "Project was updated concurrently" });
    }

    // Return Updated Files
    const filesObj = {};
    for (const [path, entry] of Object.entries(updatedProject.files)) {
      filesObj[path] = entry.content;
    }

    res.json({
      _id: updatedProject._id,
      name: updatedProject.name,
      description: updatedProject.description,
      files: filesObj,
      messages: updatedProject.messages,
      version: updatedProject.version,
      status: updatedProject.status,
      applied,
      errors,
      aiDescription: result.description,
    });
  } catch (err) {
    console.error(`[AI Revision Error]: ${err.message}`);
    const failedProject = await Project.findOneAndUpdate(
      {
        _id: project._id,
        owner: req.user.userId,
        version: baseVersion,
      },
      { $set: { error: err.message, status: "completed" } },
    );
    if (!failedProject) {
      await Project.updateOne(
        { _id: project._id, owner: req.user.userId, status: "revising" },
        { $set: { status: "completed" } },
      );
      return res
        .status(409)
        .json({ error: "Project was updated concurrently" });
    }
    res
      .status(500)
      .json({ error: err.message || "Failed To Procced Revision Request" });
  }
}
// Hello
