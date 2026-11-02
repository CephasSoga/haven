import { useEffect, useRef } from "react";
import type { PartialBlock } from "@blocknote/core";
import { BlockNoteContext, useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView, darkDefaultTheme, lightDefaultTheme, type Theme } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { useIsDark } from "@/store/settings";
import { useNotes, type Blocks } from "./store";

const font = '"Inter Variable", ui-sans-serif, system-ui, sans-serif';

const light: Theme = {
  ...lightDefaultTheme,
  fontFamily: font,
  borderRadius: 10,
  colors: {
    ...lightDefaultTheme.colors,
    editor: { text: "#1b1a17", background: "transparent" },
    menu: { text: "#1b1a17", background: "#ffffff" },
    tooltip: { text: "#ffffff", background: "#1b1a17" },
    hovered: { text: "#1b1a17", background: "#efede7" },
    selected: { text: "#ffffff", background: "#7c6cff" },
    disabled: { text: "#a29e93", background: "#efede7" },
    shadow: "#d8d4c9",
    border: "#e7e4dc",
    sideMenu: "#b5b1a6",
  },
};

const dark: Theme = {
  ...darkDefaultTheme,
  fontFamily: font,
  borderRadius: 10,
  colors: {
    ...darkDefaultTheme.colors,
    editor: { text: "#f1efe9", background: "transparent" },
    menu: { text: "#f1efe9", background: "#1c1e23" },
    tooltip: { text: "#121316", background: "#f1efe9" },
    hovered: { text: "#f1efe9", background: "#24272d" },
    selected: { text: "#121316", background: "#978bff" },
    disabled: { text: "#64625c", background: "#1c1e23" },
    shadow: "#000000",
    border: "#31353c",
    sideMenu: "#64625c",
  },
};

/** The block editor for one page: "/" for commands, drag handles, markdown shortcuts. Saves as you type. */
export function PageEditor({ pageId, content, onReady }: { pageId: string; content: Blocks; onReady?: (focus: () => void) => void }) {
  const update = useNotes((s) => s.update);
  const isDark = useIsDark();
  const pending = useRef<number | undefined>(undefined);

  const editor = useCreateBlockNote(
    { initialContent: content.length ? (content as PartialBlock[]) : undefined },
    [pageId],
  );

  useEffect(() => {
    onReady?.(() => {
      editor.focus();
      editor.setTextCursorPosition(editor.document[0], "start");
    });
  }, [editor, onReady]);

  // Flush any unsaved edit when switching pages.
  useEffect(
    () => () => {
      if (pending.current !== undefined) {
        clearTimeout(pending.current);
        update(pageId, { content: editor.document as unknown as Blocks });
      }
    },
    [editor, pageId, update],
  );

  // BlockNote would otherwise follow the OS setting; make it follow Haven's own theme.
  return (
    <BlockNoteContext.Provider value={{ colorSchemePreference: isDark ? "dark" : "light" }}>
    <BlockNoteView
      editor={editor}
      theme={isDark ? dark : light}
      className="haven-editor"
      onChange={() => {
        clearTimeout(pending.current);
        pending.current = window.setTimeout(() => {
          pending.current = undefined;
          update(pageId, { content: editor.document as unknown as Blocks });
        }, 300);
      }}
    />
    </BlockNoteContext.Provider>
  );
}
