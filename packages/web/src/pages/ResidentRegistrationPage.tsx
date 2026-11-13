import RegistrationForm from '../components/RegistrationForm';

export default function ResidentRegistrationPage() {
  return (
    <main className="registration-layout">
      <section className="registration-aside">
        <div>
          <p className="eyebrow">Community safety network</p>
          <h1 className="page-title">A little preparation can make a big difference.</h1>
          <p className="page-description">
            Register your location to receive timely warnings and request evacuation transport when
            help is available nearby.
          </p>
        </div>
        <p className="registration-aside__note">
          Your phone number is used for emergency alerts and transport coordination. Use a number
          that can receive text messages.
        </p>
      </section>
      <section aria-label="Resident registration form" className="registration-main">
        <RegistrationForm kind="resident" />
      </section>
    </main>
  );
}
