import RegistrationForm from '../components/RegistrationForm';

export default function DriverRegistrationPage() {
  return (
    <main className="registration-layout">
      <section className="registration-aside">
        <div>
          <p className="eyebrow">Local response network</p>
          <h1 className="page-title">Be ready to help when your community needs you.</h1>
          <p className="page-description">
            Register your current location so the dispatch team can match transport requests with
            nearby available drivers.
          </p>
        </div>
        <p className="registration-aside__note">
          Use a phone that can receive text messages and enter the location from which you’ll
          typically respond to a pickup request.
        </p>
      </section>
      <section aria-label="Driver registration form" className="registration-main">
        <RegistrationForm kind="driver" />
      </section>
    </main>
  );
}
