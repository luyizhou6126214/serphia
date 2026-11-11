import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, ChevronDown, Link2, MessageCircle, Unlink2, UsersRound, X } from "lucide-react";
import type { ChannelBinding, ChannelsSnapshot } from "@shared/channel-types";
import { call } from "@/lib/api-client";
import {
  getQuickChannelBindingPopoverLayout,
  type QuickChannelBindingPopoverLayout,
} from "@/lib/quick-channel-binding-layout";
import { useI18n } from "@/i18n";
import { useQuickToolbarPopoverMotion } from "@/hooks/useQuickToolbarPopoverMotion";
import "../QuickToolbar.css";
import "./QuickChannelBinding.css";

interface QuickChannelBindingProps {
  sessionId: string;
  snapshot: ChannelsSnapshot;
  isMobile: boolean;
  onSnapshotChange: (snapshot: ChannelsSnapshot) => void;
}

export function QuickChannelBinding({ sessionId, snapshot, isMobile, onSnapshotChange }: QuickChannelBindingProps) {
  const { t } = useI18n();
  const channelName = (channel: ChannelBinding["channel"]) => {
    if (channel === "telegram") return "Telegram";
    if (channel === "feishu") return t("feishuLark", "Feishu / Lark");
    return t("weixin", "WeChat");
  };
  const [open, setOpen] = useState(false);
  const [busyBindingId, setBusyBindingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [popoverLayout, setPopoverLayout] = useState<QuickChannelBindingPopoverLayout | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;

  const closePopover = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  const updatePopoverLayout = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const next = getQuickChannelBindingPopoverLayout({
      trigger: trigger.getBoundingClientRect(),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      isMobile,
    });
    setPopoverLayout((previous) =>
      previous &&
      previous.left === next.left &&
      previous.top === next.top &&
      previous.width === next.width &&
      previous.maxHeight === next.maxHeight &&
      previous.placement === next.placement
        ? previous
        : next,
    );
  }, [isMobile]);

  const currentBindings = useMemo(
    () => snapshot.bindings.filter((binding) => binding.sessionId === sessionId),
    [sessionId, snapshot.bindings],
  );
  const accountNames = useMemo(
    () => [
      ...new Set(
        currentBindings.flatMap((binding) => {
          const account = snapshot.accounts.find((candidate) => candidate.id === binding.accountId);
          return account ? [account.name] : [];
        }),
      ),
    ],
    [currentBindings, snapshot.accounts],
  );
  const online = currentBindings.some((binding) =>
    snapshot.statuses.some((status) => status.accountId === binding.accountId && status.connected),
  );
  const available = snapshot.accounts.some((account) => account.configured) || snapshot.bindings.length > 0;
  const currentChannels = [...new Set(currentBindings.map((binding) => binding.channel))];
  const showPopover = available && open && popoverLayout !== null;

  useQuickToolbarPopoverMotion(dialogRef, showPopover);

  useEffect(() => {
    setOpen(false);
    setError("");
  }, [sessionId]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || dialogRef.current?.contains(target)) return;
      closePopover();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closePopover(true);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closePopover, open]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePopoverLayout();

    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            updatePopoverLayout();
          });
    if (triggerRef.current) observer?.observe(triggerRef.current);
    if (rootRef.current?.parentElement) observer?.observe(rootRef.current.parentElement);

    window.addEventListener("resize", updatePopoverLayout);
    window.addEventListener("scroll", updatePopoverLayout, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", updatePopoverLayout);
      window.removeEventListener("scroll", updatePopoverLayout, true);
    };
  }, [open, updatePopoverLayout]);

  if (!available) return null;

  const updateBinding = async (binding: ChannelBinding, bind: boolean) => {
    setBusyBindingId(binding.id);
    setError("");
    try {
      const next = await call("channels.bindingUpsert", {
        binding: {
          ...binding,
          sessionId: bind ? sessionId : undefined,
          lastUsedAt: new Date().toISOString(),
        },
      });
      onSnapshotChange(next);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyBindingId(null);
    }
  };

  const bound = currentBindings.length > 0;
  const singleChannel = currentChannels.length === 1 ? currentChannels[0] : undefined;
  const accent =
    singleChannel === "telegram"
      ? "#229ed9"
      : singleChannel === "weixin"
        ? "#07c160"
        : singleChannel === "feishu"
          ? "#3370ff"
          : "var(--action-blue)";
  const label = bound
    ? online
      ? singleChannel
        ? `${t("connectedToChannel", "Connected to")} ${channelName(singleChannel)}`
        : t("connectedToMessagingChannels", "Connected to messaging channels")
      : t("boundToMessagingChannelsOffline", "Bound to messaging channels (offline)")
    : t("bindMessagingConversation", "Bind messaging conversation");

  return (
    <>
      <div ref={rootRef} style={{ position: "relative", marginLeft: 10, minWidth: 0, flexShrink: 1 }}>
        <button
          ref={triggerRef}
          type="button"
          data-testid={bound ? "channel-binding-indicator" : "channel-quick-bind-button"}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? dialogId : undefined}
          title={`${bound ? t("channelBindingIndicatorTitle", "This UI session is shared with messaging channels") : t("bindChannelToCurrentSession", "Bind a messaging conversation to this session")}${accountNames.length > 0 ? ` · ${accountNames.join(", ")}` : ""}`}
          onClick={() => {
            setError("");
            setOpen((value) => !value);
          }}
          className="quick-toolbar-trigger"
          style={{ maxWidth: isMobile ? 148 : 280 }}
        >
          <span className="quick-toolbar-trigger-icon" aria-hidden="true">
            <Link2 size={14} />
            {bound && (
              <span className="quick-toolbar-trigger-status" style={{ backgroundColor: online ? accent : undefined }} />
            )}
          </span>
          <span className="quick-toolbar-trigger-label">
            {label}
            {!isMobile && currentBindings.length > 1
              ? ` · ${currentBindings.length} ${t("conversations", "conversations")}`
              : ""}
          </span>
          <ChevronDown className="quick-toolbar-trigger-chevron" size={11} aria-hidden="true" />
        </button>
      </div>

      {showPopover &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={dialogRef}
            id={dialogId}
            role="dialog"
            tabIndex={-1}
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            data-testid="channel-quick-bind-popover"
            data-placement={popoverLayout.placement}
            className="quick-toolbar-popover chat-appearance-scope"
            style={{
              top: popoverLayout.top,
              left: popoverLayout.left,
              width: popoverLayout.width,
              maxHeight: popoverLayout.maxHeight,
            }}
          >
            <span className="quick-toolbar-halo" aria-hidden="true" />
            <div className="quick-channel-binding-content">
              <header className="quick-toolbar-header">
                <span className="quick-toolbar-mark" aria-hidden="true">
                  <Link2 size={19} />
                </span>
                <div>
                  <h2 id={titleId}>{t("quickChannelBinding", "Quick messaging-channel binding")}</h2>
                  <p id={descriptionId}>
                    {t(
                      "quickChannelBindingDescription",
                      "Choose the messaging conversation that should share this active UI session.",
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  className="quick-toolbar-icon-button"
                  aria-label={t("close", "Close")}
                  onClick={() => closePopover(true)}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </header>

              {error && (
                <div className="quick-toolbar-error" role="alert">
                  {error}
                </div>
              )}

              <div className="quick-channel-binding-list">
                {snapshot.bindings.length === 0 ? (
                  <div className="quick-toolbar-empty">
                    {t(
                      "noBindableChannelConversations",
                      "No messaging conversations are available yet. Ask an approved user to send the first message.",
                    )}
                  </div>
                ) : (
                  snapshot.bindings.map((binding) => {
                    const account = snapshot.accounts.find((candidate) => candidate.id === binding.accountId);
                    const boundHere = binding.sessionId === sessionId;
                    const boundElsewhere = Boolean(binding.sessionId) && !boundHere;
                    const busy = busyBindingId === binding.id;
                    const isGroup = binding.peerKind === "group";
                    const ConversationIcon = isGroup ? UsersRound : MessageCircle;
                    const conversationType = isGroup ? t("groupConversation", "Group") : t("directConversation", "DM");
                    const conversationName = `${account?.name ?? channelName(binding.channel)} · ${conversationType}`;
                    const ActionIcon = boundHere ? Unlink2 : ArrowRight;
                    return (
                      <div
                        key={binding.id}
                        className="quick-channel-binding-row"
                        data-quick-toolbar-row
                        data-channel={binding.channel}
                        data-bound-here={boundHere}
                      >
                        <div className="quick-channel-binding-identity">
                          <span className="quick-toolbar-mark" aria-hidden="true">
                            <ConversationIcon size={16} />
                          </span>
                          <div className="quick-channel-binding-copy">
                            <div className="quick-channel-binding-name" title={conversationName}>
                              {conversationName}
                            </div>
                            <div className="quick-channel-binding-peer" title={binding.peerId}>
                              {binding.peerId}
                            </div>
                            {(boundHere || boundElsewhere) && (
                              <div className="quick-channel-binding-status">
                                {boundHere
                                  ? t("boundToCurrentSession", "Bound to current session")
                                  : t("boundToAnotherSession", "Bound to another session")}
                              </div>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="quick-toolbar-action"
                          disabled={busyBindingId !== null}
                          aria-busy={busy || undefined}
                          onClick={() => void updateBinding(binding, !boundHere)}
                        >
                          {busy
                            ? t("saving", "Saving…")
                            : boundHere
                              ? t("unbind", "Unbind")
                              : boundElsewhere
                                ? t("rebindHere", "Rebind here")
                                : t("bindHere", "Bind here")}
                          <ActionIcon size={13} aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
