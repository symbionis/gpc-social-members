"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { useEffect } from "react";

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

/**
 * TipTap-backed rich-text editor with a deliberately minimal toolbar:
 * paragraph, H2, H3, bold, italic, bullet/ordered list, link.
 *
 * Output is plain HTML compatible with the members-comms email template.
 * Code blocks, blockquotes, and images are intentionally not exposed —
 * those don't render reliably across email clients.
 */
export default function RichTextEditor({
  value,
  onChange,
  placeholder,
}: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        // Keep email-safe — these surfaces are hidden from the toolbar but
        // we also disable them at the schema level so paste cannot smuggle
        // them in.
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
    ],
    content: value,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none min-h-[240px] px-4 py-3 focus:outline-none text-marine font-body",
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(html === "<p></p>" ? "" : html);
    },
  });

  // Keep editor content in sync if `value` is reset externally (e.g. clearing
  // the form after send).
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== value && value === "") {
      editor.commands.clearContent();
    }
  }, [value, editor]);

  if (!editor) {
    return (
      <div className="rounded-lg border border-border bg-white text-sm text-muted-foreground p-4">
        Loading editor…
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-white overflow-hidden">
      <Toolbar editor={editor} />
      <div className="border-t border-border">
        <EditorContent editor={editor} />
        {placeholder && editor.isEmpty && (
          <div className="px-4 -mt-[240px] pt-3 pointer-events-none text-muted-foreground text-sm font-body">
            {placeholder}
          </div>
        )}
      </div>
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  function setLink() {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  const btn =
    "px-2 py-1 rounded text-xs font-body border border-transparent hover:bg-cream transition-colors";
  const active = "bg-marine text-white border-marine hover:bg-marine-light";

  return (
    <div className="flex flex-wrap items-center gap-1 px-2 py-2 bg-cream/50 text-marine">
      <button
        type="button"
        onClick={() => editor.chain().focus().setParagraph().run()}
        className={`${btn} ${editor.isActive("paragraph") ? active : ""}`}
      >
        ¶
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={`${btn} ${editor.isActive("heading", { level: 2 }) ? active : ""}`}
      >
        H2
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        className={`${btn} ${editor.isActive("heading", { level: 3 }) ? active : ""}`}
      >
        H3
      </button>
      <span className="w-px h-5 bg-border mx-1" />
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={`${btn} ${editor.isActive("bold") ? active : ""}`}
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`${btn} ${editor.isActive("italic") ? active : ""}`}
      >
        <em>I</em>
      </button>
      <span className="w-px h-5 bg-border mx-1" />
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={`${btn} ${editor.isActive("bulletList") ? active : ""}`}
      >
        • List
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={`${btn} ${editor.isActive("orderedList") ? active : ""}`}
      >
        1. List
      </button>
      <span className="w-px h-5 bg-border mx-1" />
      <button
        type="button"
        onClick={setLink}
        className={`${btn} ${editor.isActive("link") ? active : ""}`}
      >
        Link
      </button>
    </div>
  );
}
