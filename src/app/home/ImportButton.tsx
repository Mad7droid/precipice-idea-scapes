import { useRef } from "react";
import { buttonClass, type ButtonVariant } from "@/design/Button";
import { ImportIcon } from "./icons";

/** A file input styled as a button. Validation happens in `onFile`, never in the picker. */
export function ImportButton({
  onFile,
  disabled = false,
  variant = "ghost",
  label = "Import",
}: {
  onFile: (file: File) => void;
  disabled?: boolean;
  variant?: ButtonVariant;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        title="Open a .scape file or a library backup. Imports are added as new copies and never replace existing scapes."
        className={buttonClass({ variant })}
      >
        <ImportIcon />
        {label}
      </button>
      <input
        ref={input}
        type="file"
        // Keep the native macOS picker unrestricted: WKWebView can disable
        // custom extensions such as .scape-library before our validator sees it.
        // onFile performs the format and size validation before persisting data.
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </>
  );
}
