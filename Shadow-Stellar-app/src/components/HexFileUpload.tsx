import { useState, useRef, type DragEvent } from "react";
import { cn } from "@/lib/utils";

interface HexFileUploadProps {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  placeholder?: string;
  accept?: string;
  className?: string;
}

export function HexFileUpload({
  label,
  value,
  onChange,
  placeholder = "Paste hex or drop .hex file",
  accept = ".hex,.proof,.pub,.vk,.txt",
  className,
}: HexFileUploadProps) {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) ?? "";
      onChange(text.trim());
    };
    reader.readAsText(file);
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };
  const onDragLeave = () => setDragging(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{label}</div>
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          "relative flex items-center gap-2 bg-surface-deep border rounded-sm transition-colors",
          dragging ? "border-amber-core bg-amber-core/5" : "border-edge",
        )}
      >
        <input
          value={value}
          onChange={(e) => { setFileName(null); onChange(e.target.value); }}
          placeholder={fileName ? `Loaded: ${fileName}` : placeholder}
          className="flex-1 bg-transparent outline-none font-mono text-[11px] text-foreground px-3 py-2 min-w-0"
        />
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="shrink-0 mr-1 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.15em] text-amber-core hover:underline"
        >
          {fileName ? "Change" : "Browse"}
        </button>
      </div>
      {fileName && (
        <div className="font-mono text-[9px] text-muted-foreground tracking-[0.12em]">
          📄 {fileName}
        </div>
      )}
    </div>
  );
}
