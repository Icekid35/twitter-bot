import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X, ChevronLeft, ChevronRight, Inbox, Loader2 } from "lucide-react";
export const ToastContext = createContext<
  (message: string, error?: boolean) => void
>(() => {});
export const useToast = () => useContext(ToastContext);
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span className={`badge ${tone}`}>
      <span className="status-dot" />
      {children}
    </span>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`toggle ${checked ? "on" : ""}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
export function Button({
  children,
  busy = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`button ${props.className || ""}`}
    >
      {busy ? <Loader2 size={16} className="spin" /> : null}
      {children}
    </button>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Inbox size={25} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function ErrorBox({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="error-box" role="alert">
      {message}
      {retry ? <Button onClick={retry}>Try again</Button> : null}
    </div>
  );
}
export function Skeleton() {
  return (
    <div className="skeleton-group" aria-label="Loading content">
      {[1, 2, 3].map((i) => (
        <div className="skeleton" key={i} />
      ))}
    </div>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{actions}</div>
    </div>
  );
}
export function Panel({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title ? (
        <div className="panel-heading">
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog ref={ref} onCancel={onClose} aria-label={title}>
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Confirm({
  title,
  description,
  label = "Confirm",
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  label?: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title={title} onClose={() => !busy && onClose()}>
      <p className="muted">{description}</p>
      {error ? <ErrorBox message={error} /> : null}
      <div className="modal-actions">
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          className="danger"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {label}
        </Button>
      </div>
    </Modal>
  );
}
export function Pager({
  page,
  pages,
  total,
  onChange,
}: {
  page: number;
  pages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="pager">
      <span>{total} records</span>
      <div>
        <Button
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={16} />
        </Button>
        <span>
          {page} / {Math.max(1, pages)}
        </span>
        <Button
          aria-label="Next page"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  );
}
export function Avatar({ name, src }: { name: string; src?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="avatar">
      {src && !failed ? (
        <img src={src} alt="" onError={() => setFailed(true)} />
      ) : (
        name.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}
export function relative(value: string | null | undefined) {
  if (!value) return "Not yet";
  const minutes = Math.floor((Date.now() - Date.parse(value)) / 60000);
  if (minutes < 0) return `in ${Math.abs(minutes)} min`;
  if (minutes === 0) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hr ago`;
  return new Date(value).toLocaleDateString();
}
export function dateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not yet";
}
