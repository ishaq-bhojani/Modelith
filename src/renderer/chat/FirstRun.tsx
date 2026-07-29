import { useAppStore } from '../state/store.js'
import { IconLock, IconPlus } from '../app/icons.js'

/**
 * Shown when there is no active session. Copy is taken from the "First run"
 * frame of the design: the app states what it needs rather than presenting an
 * empty pane with no explanation.
 */
export function FirstRun(): React.JSX.Element {
  const create = useAppStore((s) => s.newSession)
  const openSettings = useAppStore((s) => s.openSettings)
  const providers = useAppStore((s) => s.providers)

  const hasLocalProvider = providers.some((p) => p.id === 'ollama' || p.id === 'lmstudio')

  return (
    <div className="empty" data-testid="first-run">
      <div className="empty-inner">
        <h1 className="empty-title">
          Watch it build,
          <br />
          see it render.
        </h1>
        <p className="empty-body">
          Bring your own key. It goes straight into the OS keychain and never reaches the
          interface.
        </p>

        <div className="empty-steps">
          <div className="empty-step">
            <span className="empty-step-num">1</span>
            <span className="empty-step-text">
              Connect a provider — Anthropic, Kimi, OpenRouter, DeepSeek or Groq.
            </span>
            <button className="button-secondary" onClick={openSettings}>
              Settings
            </button>
          </div>

          {hasLocalProvider ? (
            <div className="empty-step empty-step-done">
              <span className="empty-step-num">
                <IconLock size={12} />
              </span>
              <span className="empty-step-text">
                Or run a local model — Ollama and LM Studio need no key at all.
              </span>
            </div>
          ) : null}

          <div className="empty-step">
            <span className="empty-step-num">2</span>
            <span className="empty-step-text">
              Start a chat. Conversations are stored as plain JSONL on this machine.
            </span>
            <button className="button-compact" onClick={() => void create()}>
              <IconPlus size={14} />
              New chat
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
