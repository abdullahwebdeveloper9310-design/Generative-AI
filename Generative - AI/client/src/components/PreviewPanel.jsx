import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  SandpackCodeEditor,
  SandpackLayout,
  SandpackPreview,
  SandpackProvider,
  useSandpack,
} from "@codesandbox/sandpack-react";
import { detectDependencies } from "../utils/sandpackUtils";
import { useAppContext } from "../context/AppContext";
import SandpackErrorMonitor from "./SandpackErrorMonitor";

// Watches for file edits inside Sandpack
// and syncs changes to live state + database.
function SandpackFileWatcher({ onLiveFilesChanges }) {
  const { sandpack } = useSandpack();
  const { activeProject, updateProjectFiles } = useAppContext();

  const activeProjectRef = useRef(activeProject);

  useEffect(() => {
    activeProjectRef.current = activeProject;
  }, [activeProject]);

  useEffect(() => {
    const project = activeProjectRef.current;

    if (!project) return;

    const updatedFiles = {};

    for (const [path, fileObj] of Object.entries(sandpack.files)) {
      updatedFiles[path] =
        typeof fileObj === "string" ? fileObj : (fileObj?.code ?? "");
    }

    // Update local/live state
    onLiveFilesChanges(updatedFiles);

    // Check whether anything actually changed
    let hasChanges = false;

    for (const [path, code] of Object.entries(updatedFiles)) {
      const originalFile = project.files?.[path];

      const originalCode =
        typeof originalFile === "string"
          ? originalFile
          : (originalFile?.content ?? "");

      if (originalCode !== code) {
        hasChanges = true;
        break;
      }
    }

    if (hasChanges) {
      updateProjectFiles(updatedFiles);
    }
  }, [sandpack.files, onLiveFilesChanges, updateProjectFiles]);

  return null;
}

const PreviewPanel = ({ project, activeFile, showCode }) => {
  const [showErrorOverlay, setShowErrorOverlay] = useState(true);

  const [liveFiles, setLiveFiles] = useState(project.files ?? {});

  const currentKey = `${project._id}-${project.version}`;

  const projectKeyRef = useRef(currentKey);

  // Reset live files when switching projects/versions
  useEffect(() => {
    if (projectKeyRef.current !== currentKey) {
      projectKeyRef.current = currentKey;
      setLiveFiles(project.files ?? {});
    }
  }, [currentKey, project.files]);

  // Keep live files updated
  const handleLiveFilesChange = useMemo(
    () => (newFiles) => {
      setLiveFiles((prev) => {
        let changed = false;

        for (const [path, code] of Object.entries(newFiles)) {
          if (prev[path] !== code) {
            changed = true;
            break;
          }
        }

        if (
          !changed &&
          Object.keys(prev).length === Object.keys(newFiles).length
        ) {
          return prev;
        }

        return newFiles;
      });
    },
    [],
  );

  // Convert live files into Sandpack format
  const sandpackFiles = useMemo(() => {
    const spFiles = {};

    for (const [path, content] of Object.entries(liveFiles)) {
      const fileCode =
        typeof content === "string" ? content : (content?.content ?? "");

      spFiles[path] = {
        code: fileCode,
        active: path === activeFile,
      };
    }

    return spFiles;
  }, [liveFiles, activeFile]);

  // Detect dependencies from imports in live files
  const dependencies = useMemo(() => {
    return detectDependencies(liveFiles);
  }, [liveFiles]);

  if (!project) {
    return null;
  }

  return (
    <div className="h-full w-full">
      <SandpackProvider
        key={currentKey}
        template="react"
        files={sandpackFiles}
        customSetup={{
          dependencies,
        }}
        options={{
          externalResources: [
            "https://cdn.tailwindcss.com",
            "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css",
          ],
          classes: {
            "sp-wrapper": "sp-wrapper",
            "sp-layout": "sp-layout",
            "sp-preview": "sp-preview",
          },
          logLevel: 0,
        }}
        theme={{
          colors: {
            surface1: "#ffffff",
            surface2: "#f4f4f5",
            surface3: "#e4e4e7",
            clickable: "#71717a",
            base: "#09090b",
            disabled: "#a1a1aa",
            hover: "#18181b",
            accent: "#18181b",
            error: "#ef4444",
            errorSurface: "#fef2f2",
          },
          font: {
            body: "'Urbanist', system-ui, -apple-system, sans-serif",
            mono: "'Giest Mono', ui-monospace, monospace",
            size: "13px",
            lineHeight: "1.6",
          },
        }}
      >
        <SandpackFileWatcher onLiveFilesChanges={handleLiveFilesChange} />
        <SandpackErrorMonitor onErrorChange={setShowErrorOverlay} />
        <SandpackLayout
          style={{
            height: "100%",
            border: "none",
            borderRadius: 0,
            background: "transparent",
          }}
        >
          {showCode && (
            <SandpackCodeEditor
              showTabs
              showLineNumbers
              showInlineErrors
              wrapContent
              style={{
                height: "100%",
                flex: 1,
                minWidth: 0,
              }}
            />
          )}
          <SandpackPreview
            showNavigator={false}
            showRefreshButton
            showOpenInCodeSandbox={false}
            showSandpackErrorOverlay={showErrorOverlay}
            style={{
              height: "100%",
              flex: showCode ? 1 : 2,
              minWidth: 0,
            }}
          />
        </SandpackLayout>
      </SandpackProvider>
    </div>
  );
};

export default PreviewPanel;
// hello
