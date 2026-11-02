import {
  CHAT_PANEL_ID,
  useChatApi,
  useChatPanel,
} from '@nocobase/app-plugin-agents/client/chat';
import { BotMessageSquareIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import { useLocation } from 'react-router';

import { Button } from '#components/ui/button';

import { ChatPanel } from '#extensions/nocobase-agent-chat/chat-panel';

/** One assistant per module: the scope comes from `server/providers/agents.ts`. */
interface Assistant {
  /** The route the assistant belongs to; the longest match wins. */
  readonly prefix: string;
  /** The scope the conversation is created in — its tools and prompt. */
  readonly scope: string;
  /** The conversation title, which is also the name shown in the window. */
  readonly title: string;
}

const general: Assistant = {
  prefix: '/',
  scope: 'group-erp/general',
  title: '集团助手',
};

const assistants: readonly Assistant[] = [
  {
    prefix: '/functions/warehouse',
    scope: 'group-erp/warehouse',
    title: '仓储助手',
  },
  {
    prefix: '/functions/procurement',
    scope: 'group-erp/procurement',
    title: '采购助手',
  },
  {
    prefix: '/functions/requisitions',
    scope: 'group-erp/requisitions',
    title: '领用助手',
  },
  { prefix: '/functions/sales', scope: 'group-erp/sales', title: '销售助手' },
  { prefix: '/functions/hse', scope: 'group-erp/hse', title: '安环助手' },
  {
    prefix: '/functions/production',
    scope: 'group-erp/production',
    title: '生产助手',
  },
  {
    prefix: '/functions/operations',
    scope: 'group-erp/operations',
    title: '运营助手',
  },
  { prefix: '/functions/assets', scope: 'group-erp/assets', title: '资产助手' },
  {
    prefix: '/functions/personnel',
    scope: 'group-erp/people',
    title: '人事助手',
  },
  { prefix: '/functions/people', scope: 'group-erp/people', title: '人事助手' },
  { prefix: '/human-resources', scope: 'group-erp/people', title: '人事助手' },
  {
    prefix: '/organization',
    scope: 'group-erp/organization',
    title: '组织助手',
  },
];

/**
 * Whether `pathname` is the module at `prefix`. The router may report the path with the application's base path in
 * front of it (`/main/functions/hse`), so the match is on the last segments rather than the first.
 */
const at = (pathname: string, prefix: string): boolean =>
  pathname === prefix ||
  pathname.endsWith(prefix) ||
  pathname.includes(`${prefix}/`);

const assistantFor = (pathname: string): Assistant =>
  assistants.reduce<Assistant>(
    (best, assistant) =>
      at(pathname, assistant.prefix) &&
      assistant.prefix.length > best.prefix.length
        ? assistant
        : best,
    general,
  );

/**
 * The agent chat as a window of its own: a button in the bottom-right corner, and the panel floating above it instead
 * of taking a column from the page. Above `md` only; the block's own launcher covers smaller screens.
 *
 * The window follows the module the person is on: each module gets its own assistant, its own scope, and its own
 * conversation, kept while the session lasts.
 */
export function FloatingChat(): ReactElement | null {
  const panel = useChatPanel();
  const api = useChatApi();
  const { pathname } = useLocation();
  const assistant = assistantFor(pathname);
  const conversationsRef = useRef(new Map<string, string>());
  const openingRef = useRef(false);
  const moduleRef = useRef(assistant.scope);

  const open = useCallback(async (): Promise<void> => {
    if (panel.open || openingRef.current) return;
    openingRef.current = true;
    try {
      const known = conversationsRef.current.get(assistant.scope);
      if (known) {
        panel.openChat({ conversationId: known });
        return;
      }
      const created = await api.createConversation({
        agentId: 'online',
        title: assistant.title,
        config: { scope: [assistant.scope] },
      });
      conversationsRef.current.set(assistant.scope, created.id);
      panel.openChat({ conversationId: created.id });
    } catch {
      // No scope, no permission to create: the panel's own new conversation still works.
      panel.openChat();
    } finally {
      openingRef.current = false;
    }
  }, [api, assistant.scope, assistant.title, panel]);

  // Switching modules closes the window instead of silently swapping the assistant under the open conversation.
  useEffect(() => {
    if (moduleRef.current === assistant.scope) return;
    moduleRef.current = assistant.scope;
    if (panel.open) panel.closeChat();
  }, [assistant.scope, panel]);

  // The plugin remembers an open panel across page loads; the conversation in it belongs to the module it was opened
  // in, so a new page starts with the button and asks for its own module's assistant.
  const restoredRef = useRef(panel.open);
  useEffect(() => {
    if (!restoredRef.current) return;
    restoredRef.current = false;
    panel.closeChat();
  }, [panel]);

  if (!panel.available) return null;

  // The panel's own "expand" means "cover the content area": in a window of its own it has no content area to cover,
  // so the window itself grows instead, and the panel's split layout gets a body wide enough to sit in.
  const expanded = panel.mode === 'expanded';

  if (!panel.open)
    return (
      <Button
        variant='outline'
        size='icon'
        aria-label={assistant.title}
        aria-controls={CHAT_PANEL_ID}
        className='fixed right-6 bottom-6 z-40 hidden size-12 rounded-full border-border bg-background text-foreground shadow-lg md:inline-flex'
        onClick={() => void open()}
        data-testid='agent-chat-launcher'
      >
        <BotMessageSquareIcon className='size-5' />
      </Button>
    );

  if (expanded)
    return (
      <div
        role='presentation'
        className='fixed inset-0 z-40 hidden items-center justify-center bg-foreground/20 p-4 backdrop-blur-sm md:flex md:p-8'
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) panel.closeChat();
        }}
        data-testid='agent-chat-backdrop'
      >
        <div
          role='dialog'
          aria-label={assistant.title}
          className='relative flex h-[min(52rem,100%)] w-full max-w-6xl overflow-hidden rounded-xl border bg-background shadow-2xl'
          data-testid='agent-chat-window'
        >
          <ChatPanel />
        </div>
      </div>
    );

  return (
    <div
      role='dialog'
      aria-label={assistant.title}
      className='fixed right-6 bottom-6 z-40 hidden h-[min(40rem,calc(100dvh-7rem))] w-[22rem] overflow-hidden rounded-xl border bg-background shadow-2xl md:flex 2xl:w-[26.25rem] [&>aside]:w-full [&>aside]:border-l-0'
      data-testid='agent-chat-window'
    >
      <ChatPanel />
    </div>
  );
}
