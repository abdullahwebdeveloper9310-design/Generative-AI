import { Project } from "../models/Project.js";
import crypto from "crypto";
import { generateProject } from "../services/ai.js";

function hashContent(content) {
  return crypto.createHash("md5").update(content).digest("hex").slice(0, 12);
}

// POST /api/projects
// Create a New Project From AI Prompt
export async function createProject(req, res) {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "Prompt Is Required" });
    return;
  }

  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Create Project In DB Immediately With "Pending" Status
  const project = await Project.create({
    name: "Planning Project",
    files: {},
    messages: [
      { role: "user", content: prompt },
      { role: "assistant", content: prompt },
    ],
    version: 0,
    owner: req.user.userId,
    status: "pending",
    filesPlanned: [],
    filesGenerated: [],
    currentFile: null,
    error: null,
  });

  // Start Background Generations
  runBackgroundGeneration(project._id.toString(), prompt).catch((err) => {
    console.error(
      `[Background AI] Fatal Generation Error For Project ${project._id}:`,
      err,
    );
  });

  res.status(201).json({
    _id: project._id,
    name: project.name,
    description: project.description,
    files: {},
    messages: project.messages,
    version: project.version,
    status: project.status,
    filesPlanned: project.filesPlanned,
    filesGenerated: project.filesGenerated,
    currentFile: project.currentFile,
    error: project.error,
    createdAt: project.createdAt,
  });
}

// Background Worker To Progress Generative Files And Update Database In Real- Time
async function runBackgroundGeneration(projectId, prompt) {
  try {
    console.log(`[Background AI] Starting Generating For Project ${projectId}`);
    const result = await generateProject(prompt, {
      onPlan: async (plan) => {
        console.log(
          `[Background AI] Starting Generating For Project ${projectId}. Planned ${plan.files.length} files`,
        );
        const fileList = plan.files
          .map((f) => `- \`${f.path}\`: ${f.description}`)
          .join("\n");

        await Project.findByIdAndUpdate(projectId, {
          name: plan.projectName || "Generated Project",
          status: "generating",
          filesPlanned: plan.files,
          $push: {
            messages: {
              role: "assistant",
              content: `Planned Website Structure:\n${fileList}`,
              timestamp: new Date(),
            },
          },
        });
      },
      onFileStart: async (path) => {
        console.log(
          `[Background AI] Starting File ${path}. Project ${projectId}.`,
        );
        await Project.findByIdAndUpdate(projectId, {
          currentFile: path,
        });
      },
      onFileComplete: async (path, code) => {
        console.log(
          `[Background AI] Finished File ${path}. Project ${projectId}.`,
        );

        const project = await Project.findById(projectId);

        if (project) {
          project.files = project.files || {};
          project.files[path] = { content: code, hash: hashContent(code) };
          project.filesGenerated = [...(project.filesGenerated || []), path];
          project.messages.push({
            role: "assistant",
            content: `Created File:${path}`,
            timestamp: new Date(),
          });
          project.currentFile = null;
          project.markModified("files");
          await project.save();
        }
      },
    });

    console.log(`[Background AI] Successfully Generated Project ${projectId}`);

    const project = await Project.findById(projectId);
    if (project) {
      project.status = "completed";
      project.version = 1;
      if (result.description) {
        project.name = result.description;
      }
      project.messages.push({
        role: "assistant",
        content: `Website Generated Completing Now You Can View And Edit The Files`,
        timestamp: new Date(),
      });
      await project.save();
    }
  } catch (err) {
    console.log(
      `[Background AI] Fatal Error Generation For Project ${projectId}`,
      err,
    );
    await Project.findByIdAndUpdate(projectId, {
      status: "failed",
      error: err.message,
      $push: {
        messages: {
          role: "assistant",
          content: `Generation Failed ${err.message}`,
          timestamp: new Date(),
        },
      },
    });
  }
}

// GET /api/projects
// Listed All Projects Owned By The Users (Summary Only, No File Contents)
export async function listProjects(req, res) {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const projects = await Project.find(
    { owner: req.user.userId },
    { name: 1, description: 1, version: 1, createdAt: 1, updatedAt: 1 },
  ).sort({ updatedAt: -1 });

  res.json(projects);
}

// GET /api/projects/:id
// Get Full Projects Details
export async function getProject(req, res) {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const project = await Project.findOne({
    _id: req.params.id,
    owner: req.user.userId,
  });

  if (!project) {
    res.status(401).json({ error: "Project Not Found" });
    return;
  }

  const filesObj = {};
  for (const [path, entry] of Object.entries(project.files)) {
    filesObj[path] = entry.content;
  }

  res.json({
    _id: project._id,
    name: project.name,
    description: project.description,
    files: filesObj,
    messages: project.messages,
    version: project.version,
    status: project.status,
    filesPlanned: project.filesPlanned,
    filesGenerated: project.filesGenerated,
    currentFile: project.currentFile,
    error: project.error,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  });
}

// DELETE /api/projects/:id
// Delete a Project
export async function deleteProject(req, res) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const result = await Project.findOneAndDelete({
    _id: req.params.id,
    owner: req.user.userId,
  });

  if (!result) {
    return res.status(404).json({ error: "Project not found!" });
  }

  return res.json({ success: true });
}

// PUT /api/projects/:id/files
// Update Project Files (Manual Edits)
export async function updateProjectFiles(req, res) {
  const files = req.body.files;

  if (!files || typeof files !== "object") {
    res.status(400).json({ error: "Files Object Not Found!" });
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
    res.status(400).json({ error: "Project Not Found!" });
    return;
  }

  // Rebuild Project Files Map With Content And Hashing
  const newFiles = {};
  for (const [path, content] of Object.entries(files)) {
    if (typeof content !== "string") {
      return res.status(400).json({
        error: `Invalid content for file: ${path}`,
      });
    }

    newFiles[path] = {
      content,
      hash: hashContent(content),
    };
  }

  const updatedProject = await Project.findOneAndUpdate(
    {
      _id: project._id,
      owner: req.user.userId,
      version: project.version,
    },
    {
      $set: { files: newFiles },
      $inc: { version: 1 },
    },
    { returnDocument: "after" },
  );

  if (!updatedProject) {
    return res.status(409).json({ error: "Project was updated concurrently" });
  }

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
    createdAt: updatedProject.createdAt,
    updatedAt: updatedProject.updatedAt,
  });
}

// POST /api/projects/:id/publish
// Mark A Project As Publicly Published
export async function publishProject(req, res) {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const project = await Project.findOneAndUpdate(
    {
      _id: req.params.id,
      owner: req.user.userId,
    },
    { published: true },
    { returnDocument: "after" },
  );

  if (!project) {
    res.status(404).json({ error: "Project Not Found!" });
    return;
  }

  res.json({ success: true, published: project.published });
}

// GET /api/projects/public/:id
// Get A Publicly Publish Project Details (Without Auth)
export async function getPublicProject(req, res) {
  const project = await Project.findById(req.params.id);
  if (!project) {
    res.status(404).json({ error: "Project Not Found!" });
    return;
  }

  if (!project.published) {
    res.status(403).json({ error: "Project Is Not Published Yet!" });
    return;
  }

  const filesObj = {};
  for (const [path, entry] of Object.entries(project.files)) {
    filesObj[path] = entry.content;
  }

  res.json({
    _id: project._id,
    name: project.name,
    description: project.description,
    files: filesObj,
    version: project.version,
  });
}
// Hello
