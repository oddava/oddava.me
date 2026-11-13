import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { MEASURES, SPOTLIGHTS, type FocusPrefs } from './studioFocusPrefs';
import { studioFocus } from './studioFocusStore';
import { shortcut } from './studioHelpers';
import { Icon } from './studioIcons';
import { useStudioFocusState } from './useStudioFocus';

interface Choice<T extends string> {
  value: T;
  label: string;
  /** The spoken name, where the label is a letter. */
  name?: string;
}

const SIZE_CHOICES: Choice<FocusPrefs['textSize']>[] = [
  { value: 'sm', label: 'S', name: 'Small' },
  { value: 'md', label: 'M', name: 'Medium' },
  { value: 'lg', label: 'L', name: 'Large' },
];
const MEASURE_LABELS: Record<FocusPrefs['measure'], string> = {
  narrow: 'Narrow',
  comfortable: 'Comfortable',
  wide: 'Wide',
};
const MEASURE_CHOICES = MEASURES.map((value) => ({
  value,
  label: MEASURE_LABELS[value],
}));
const SPOTLIGHT_LABELS: Record<FocusPrefs['spotlight'], string> = {
  paragraph: 'Paragraph',
  block: 'Block',
  off: 'Off',
};
const SPOTLIGHT_CHOICES = SPOTLIGHTS.map((value) => ({
  value,
  label: SPOTLIGHT_LABELS[value],
}));

/** One row of mutually exclusive choices. Native radios give the arrow keys for free. */
function Segments<T extends string>({
  legend,
  hint,
  name,
  value,
  choices,
  onChange,
}: {
  legend: string;
  hint?: string;
  name: string;
  value: T;
  choices: Choice<T>[];
  onChange: (next: T) => void;
}) {
  return (
    <fieldset className="studio-reading__group">
      <legend>{legend}</legend>
      {hint && <p className="studio-reading__hint">{hint}</p>}
      <div className="studio-reading__segments">
        {choices.map((choice) => (
          <label key={choice.value} className="studio-reading__segment">
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={value === choice.value}
              aria-label={choice.name}
              onChange={() => onChange(choice.value)}
            />
            <span data-choice={choice.value}>{choice.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="studio-reading__switch">
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="studio-reading__track" aria-hidden="true" />
    </label>
  );
}

interface Props {
  /** The phone's bar has room for one button, so focus mode rides in the popover. */
  compact: boolean;
}

/**
 * The bar's two calm-writing controls: a button for focus mode and the "Aa"
 * popover for reading comfort. Both talk to the shared store, so the palette
 * and the shortcut stay in step with what the buttons show.
 */
export default function StudioFocusControls({ compact }: Props) {
  const { prefs, focusMode } = useStudioFocusState();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [said, setSaid] = useState('');
  const mounted = useRef(false);

  // Into the popover when it opens, so the keyboard can reach it at once.
  useLayoutEffect(() => {
    if (!open) return;
    panel.current
      ?.querySelector<HTMLInputElement>(
        'input[name="studio-text-size"]:checked',
      )
      ?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // A press anywhere else dismisses it, the way a menu would.
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Said aloud because the palette and the shortcut change it with no
  // button to announce the change.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setSaid(focusMode ? 'Focus mode on.' : 'Focus mode off.');
  }, [focusMode]);

  return (
    <div
      className="studio-reading"
      ref={root}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        // Closing the popover is all this Escape means; focus mode stays.
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }}
      onFocusOut={(event) => {
        const next = event.relatedTarget as Node | null;
        if (open && next && !root.current?.contains(next)) setOpen(false);
      }}
    >
      {!compact && (
        <button
          type="button"
          className="studio-icon-button studio-reading__focus"
          aria-label="Focus mode"
          aria-pressed={focusMode}
          title={`Focus mode (${shortcut('F', true)})`}
          onClick={() => studioFocus.setFocusMode(!focusMode)}
        >
          <Icon name="focus" />
        </button>
      )}
      <button
        ref={trigger}
        type="button"
        className="studio-icon-button studio-reading__trigger"
        aria-label="Page style"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Page style"
        onClick={() => setOpen((was) => !was)}
      >
        <span aria-hidden="true">Aa</span>
      </button>
      {open && (
        <div
          className="studio-reading__panel"
          ref={panel}
          role="dialog"
          aria-label="Page style"
        >
          <Segments
            legend="Text size"
            name="studio-text-size"
            value={prefs.textSize}
            choices={SIZE_CHOICES}
            onChange={(textSize) => studioFocus.setPrefs({ textSize })}
          />
          <Segments
            legend="Line width"
            name="studio-measure"
            value={prefs.measure}
            choices={MEASURE_CHOICES}
            onChange={(measure) => studioFocus.setPrefs({ measure })}
          />
          <div className="studio-reading__rule" aria-hidden="true" />
          <Switch
            label="Typewriter scroll"
            checked={prefs.typewriter}
            onChange={(typewriter) => studioFocus.setPrefs({ typewriter })}
          />
          <Segments
            legend="Spotlight"
            hint="What stays lit in focus mode."
            name="studio-spotlight"
            value={prefs.spotlight}
            choices={SPOTLIGHT_CHOICES}
            onChange={(spotlight) => studioFocus.setPrefs({ spotlight })}
          />
          {compact && (
            <Switch
              label="Focus mode"
              checked={focusMode}
              onChange={(on) => {
                studioFocus.setFocusMode(on);
                if (on) setOpen(false);
              }}
            />
          )}
        </div>
      )}
      <span className="studio-visually-hidden" role="status">
        {said}
      </span>
    </div>
  );
}
