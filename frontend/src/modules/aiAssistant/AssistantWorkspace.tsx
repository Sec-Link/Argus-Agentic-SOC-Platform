'use client';

import React, { useEffect, useRef, useState } from 'react';
import FloatingAssistant from './FloatingAssistant';
import { clampChatWidth, MIN_CHAT_WIDTH, MIN_PAGE_WIDTH, SPLIT_HANDLE_WIDTH } from './assistantSplit';
import styles from './AssistantWorkspace.module.css';

export default function AssistantWorkspace({ children, pathname, readonly }: {
  children: React.ReactNode;
  pathname: string;
  readonly?: boolean;
}) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; width: number } | null>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [chatRatio, setChatRatio] = useState(0.4);
  const [expanded, setExpanded] = useState(false);
  const [resizing, setResizing] = useState(false);
  const chatWidth = clampChatWidth(workspaceWidth, (workspaceWidth - SPLIT_HANDLE_WIDTH) * chatRatio);
  const docked = expanded && chatWidth !== null;

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const observer = new ResizeObserver(([entry]) => setWorkspaceWidth(entry.contentRect.width));
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (chatWidth === null) setExpanded(false);
    if (!docked) {
      dragRef.current = null;
      setResizing(false);
    }
  }, [docked, chatWidth]);

  const resize = (width: number) => {
    const available = workspaceRef.current?.getBoundingClientRect().width ?? 0;
    const clamped = clampChatWidth(available, width);
    if (clamped !== null) setChatRatio(clamped / (available - SPLIT_HANDLE_WIDTH));
  };

  const endDrag = () => {
    dragRef.current = null;
    setResizing(false);
  };

  return (
    <div ref={workspaceRef} className={`${styles.workspace} ${resizing ? styles.resizing : ''}`}>
      <div id="argus-workspace-page" className={styles.page}>{children}</div>
      {docked && (
        <div
          className={styles.separator}
          role="separator"
          tabIndex={0}
          aria-label="Resize page and AI chat"
          aria-orientation="vertical"
          aria-controls="argus-workspace-page argus-ai-chat"
          aria-valuemin={MIN_PAGE_WIDTH}
          aria-valuemax={Math.round(workspaceWidth - SPLIT_HANDLE_WIDTH - MIN_CHAT_WIDTH)}
          aria-valuenow={Math.round(workspaceWidth - SPLIT_HANDLE_WIDTH - chatWidth)}
          aria-valuetext={`Page ${Math.round(workspaceWidth - SPLIT_HANDLE_WIDTH - chatWidth)} pixels, AI chat ${Math.round(chatWidth)} pixels`}
          title="Drag to resize, or use the arrow keys"
          data-ai-context-exclude
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary) return;
            event.preventDefault();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { pointerId: event.pointerId, startX: event.clientX, width: chatWidth };
            setResizing(true);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (drag?.pointerId === event.pointerId) resize(drag.width + drag.startX - event.clientX);
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            endDrag();
          }}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onBlur={endDrag}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 48 : 16;
            if (event.key === 'ArrowLeft') resize(chatWidth + step);
            else if (event.key === 'ArrowRight') resize(chatWidth - step);
            else if (event.key === 'Home') resize(workspaceWidth - SPLIT_HANDLE_WIDTH - MIN_PAGE_WIDTH);
            else if (event.key === 'End') resize(MIN_CHAT_WIDTH);
            else return;
            event.preventDefault();
          }}
        />
      )}
      <div className={docked ? styles.dock : undefined} style={docked ? { width: chatWidth } : undefined}>
        <FloatingAssistant pathname={pathname} readonly={readonly} docked={docked} canDock={chatWidth !== null} onDockChange={setExpanded} />
      </div>
    </div>
  );
}
