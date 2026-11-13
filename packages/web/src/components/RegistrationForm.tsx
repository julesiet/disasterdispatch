import { useState } from 'react';
import { Link } from 'react-router-dom';
import AddressSearch from './AddressSearch';

type RegistrationKind = 'resident' | 'driver';
type FormValues = { name: string; phone: string; lat: string; lng: string };
const DRIVER_PROFILE_STORAGE_KEY = 'disasterdispatch.driverId';

const EMPTY_FORM: FormValues = { name: '', phone: '', lat: '', lng: '' };
const PHONE_PATTERN = '^\\+[1-9]\\d{1,14}$';

const copy: Record<RegistrationKind, { title: string; description: string; button: string }> = {
  resident: {
    title: 'Create your resident profile',
    description: 'Add your location so nearby emergency alerts and transport offers can reach you.',
    button: 'Register as resident',
  },
  driver: {
    title: 'Join the driver network',
    description: 'Share your current location so dispatch can find the nearest available driver.',
    button: 'Register as driver',
  },
};

export default function RegistrationForm({ kind }: { kind: RegistrationKind }) {
  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<
    | { type: 'success' | 'error'; message: string }
    | null
  >(null);
  const details = copy[kind];

  const update = (field: keyof FormValues, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFeedback(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.lat || !form.lng) {
      setFeedback({ type: 'error', message: 'Search for and select your location before registering.' });
      return;
    }
    setSubmitting(true);
    setFeedback(null);

    try {
      const response = await fetch(`/api/v1/${kind === 'resident' ? 'residents' : 'drivers'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          phone: form.phone.trim(),
          lat: Number(form.lat),
          lng: Number(form.lng),
        }),
      });
      const result = (await response.json()) as { id?: string; error?: string; message?: string };

      if (!response.ok) {
        setFeedback({
          type: 'error',
          message:
            result.error ?? result.message ?? 'We could not complete your registration. Please try again.',
        });
        return;
      }

      setFeedback({
        type: 'success',
        message: `Registration complete. Your ${kind} ID is ${result.id ?? 'ready'}.`,
      });
      if (kind === 'driver' && result.id) {
        window.localStorage.setItem(DRIVER_PROFILE_STORAGE_KEY, result.id);
      }
      setForm(EMPTY_FORM);
    } catch {
      setFeedback({
        type: 'error',
        message: 'The service could not be reached. Check your connection and try again.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="registration-form" onSubmit={handleSubmit}>
      <div className="registration-form__heading">
        <h2>{details.title}</h2>
        <p>{details.description}</p>
      </div>

      <div className="form-field">
        <label htmlFor={`${kind}-name`}>Full name</label>
        <input
          autoComplete="name"
          id={`${kind}-name`}
          maxLength={120}
          name="name"
          onChange={(event) => update('name', event.target.value)}
          placeholder="Your name"
          required
          value={form.name}
        />
      </div>

      <div className="form-field">
        <label htmlFor={`${kind}-phone`}>Mobile number</label>
        <input
          autoComplete="tel"
          id={`${kind}-phone`}
          inputMode="tel"
          name="phone"
          onChange={(event) => update('phone', event.target.value)}
          pattern={PHONE_PATTERN}
          placeholder="+15551234567"
          required
          title="Use international format, for example +15551234567."
          type="tel"
          value={form.phone}
        />
        <span className="form-field__hint">Use international format, including the + and country code.</span>
      </div>

      <AddressSearch
        id={`${kind}-address`}
        label="Location address or place"
        onQueryChange={() => setForm((current) => ({ ...current, lat: '', lng: '' }))}
        onSelect={({ lat, lng }) => {
          setForm((current) => ({ ...current, lat: String(lat), lng: String(lng) }));
          setFeedback(null);
        }}
      />
      {form.lat && form.lng && (
        <p className="form-field__hint">Selected map point: {Number(form.lat).toFixed(5)}, {Number(form.lng).toFixed(5)}</p>
      )}

      <button className="primary-button" disabled={submitting} type="submit">
        {submitting ? 'Submitting…' : details.button}
      </button>

      {feedback && (
        <p
          aria-live={feedback.type === 'error' ? 'assertive' : 'polite'}
          className={`form-feedback form-feedback--${feedback.type}`}
          role={feedback.type === 'error' ? 'alert' : 'status'}
        >
          {feedback.message}
        </p>
      )}
      {kind === 'driver' && feedback?.type === 'success' && (
        <Link className="driver-view-link" to="/driver">
          Open driver view →
        </Link>
      )}
    </form>
  );
}
