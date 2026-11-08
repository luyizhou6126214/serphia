/**
 * Artwork shared by the right panel's guide and tab strip: the product's
 * fixed-palette entry artwork for the guide capsules, and the one-ink glyphs
 * the chips draw in the strip's own ink.
 */

import { Folder, Globe, LayoutGrid } from "lucide-react";
import { getFileIcon } from "@/components/FileIcons";
import type { RightPanelTab } from "@/lib/right-panel-tabs";

/** The guide's own compass: a ring with the needle's rhombus pointing north-east. */
export function CompassGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 14C11.3137 14 14 11.3137 14 8C14 4.68629 11.3137 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14Z"
        stroke="currentColor"
      />
      <path d="M10.6101 5.39014L8.99014 8.99014L5.39014 10.6101L7.01014 7.01014L10.6101 5.39014Z" fill="currentColor" />
    </svg>
  );
}

/** Amber workspace-folder artwork for the files entry. */
export function GuideArtworkFiles({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <path
        d="M10.7603 27.922H24.6817C26.3441 27.922 27.1753 27.922 27.8102 27.5984C28.3687 27.3139 28.8228 26.8598 29.1074 26.3012C29.4309 25.6663 29.4309 24.8351 29.4309 23.1727V15.4936"
        stroke="#FFCD78"
        strokeWidth="1.97886"
      />
      <path
        d="M13.1597 8.07812C13.4182 8.07818 13.6727 8.14336 13.8989 8.26855L16.7554 9.84961C16.9817 9.97485 17.2369 10.041 17.4956 10.041H26.106C26.9492 10.0412 27.6323 10.7251 27.6323 11.5684V24.5371C27.6323 25.3805 26.9483 26.0645 26.105 26.0645H8.09619C7.25281 26.0645 6.56884 25.3805 6.56885 24.5371V9.60449C6.56909 8.76133 7.25297 8.07812 8.09619 8.07812H13.1597ZM9.81592 14.5508V16.5293H24.3999V14.5508H9.81592Z"
        fill="#FFBC4D"
      />
    </svg>
  );
}

/** Blue terminal-prompt artwork for the new-terminal entry. */
export function GuideArtworkTerminal({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <path
        d="M10 11L16.606 17.606C16.6841 17.6841 16.6841 17.8107 16.606 17.8888L10 24.4948"
        stroke="#679EFE"
        strokeWidth="3.5"
      />
      <path d="M20.1211 24.4946H26.8685" stroke="#679EFE" strokeWidth="3.5" />
    </svg>
  );
}

/** Blue globe artwork for the browser entry. */
export function GuideArtworkBrowser({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <path
        d="M17.9995 28.1465C23.6034 28.1465 28.1461 23.6038 28.1461 18C28.1461 12.3963 23.6034 7.85352 17.9995 7.85352C12.3958 7.85352 7.85303 12.3963 7.85303 18C7.85303 23.6038 12.3958 28.1465 17.9995 28.1465Z"
        stroke="#539CFA"
        strokeWidth="2"
      />
      <path d="M8.57764 18H27.4211" stroke="#539CFA" strokeWidth="2" strokeLinecap="square" />
      <path
        d="M17.999 28.1467C20.0576 28.1467 21.6228 23.6039 21.6228 18C21.6228 12.3963 20.0576 7.85352 17.999 7.85352"
        stroke="#539CFA"
        strokeWidth="2"
      />
      <path
        d="M17.9992 28.1467C15.9407 28.1467 14.3755 23.6039 14.3755 18C14.3755 12.3963 15.9407 7.85352 17.9992 7.85352"
        stroke="#539CFA"
        strokeWidth="2"
      />
    </svg>
  );
}

/** Tool-grid artwork for the more-tools entry. */
export function GuideArtworkTools({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <rect x="8" y="8" width="8.6" height="8.6" rx="2.2" stroke="#98A2B8" strokeWidth="2" />
      <rect x="19.4" y="8" width="8.6" height="8.6" rx="2.2" stroke="#98A2B8" strokeWidth="2" />
      <rect x="8" y="19.4" width="8.6" height="8.6" rx="2.2" stroke="#98A2B8" strokeWidth="2" />
      <rect x="19.4" y="19.4" width="8.6" height="8.6" rx="2.2" stroke="#98A2B8" strokeWidth="2" />
    </svg>
  );
}

/** The terminal prompt the terminal chips draw. */
export function TerminalGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 4L7 8L3 12" stroke="currentColor" />
      <path d="M9 12H13" stroke="currentColor" />
    </svg>
  );
}

/**
 * The leading glyph a tab chip draws for its kind.
 * @param props - the tab and the glyph size in CSS pixels.
 * @returns the tab's glyph.
 */
export function PanelTabGlyph({ tab, size = 14 }: { tab: RightPanelTab; size?: number }) {
  switch (tab.kind) {
    case "guide":
      return <CompassGlyph size={size} />;
    case "files":
      return <Folder size={size} strokeWidth={1.7} aria-hidden="true" />;
    case "file":
      return <span aria-hidden="true">{getFileIcon(tab.title, size)}</span>;
    case "terminal":
      return <TerminalGlyph size={size} />;
    case "browser":
      return <Globe size={size} strokeWidth={1.7} aria-hidden="true" />;
    case "processes":
      return <LayoutGrid size={size} strokeWidth={1.7} aria-hidden="true" />;
    default:
      return <CompassGlyph size={size} />;
  }
}
