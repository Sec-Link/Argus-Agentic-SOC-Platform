import React, { useEffect, useMemo, useState } from 'react';
import { Form, Input, Button, message, Typography } from 'antd';
import { MailOutlined, SafetyCertificateOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { getGuestEmailStatus, registerEmail, requestOtp, verifyOtp } from 'services/accounts';

interface Props {
  onLoginSuccess: () => void;
}

const RESEND_SECONDS = 60;

type InlineHint = { tone: 'success' | 'info'; text: string } | null;

const ExternalOtpForm: React.FC<Props> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'idle' | 'verify'>('idle');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [checking, setChecking] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [nextAction, setNextAction] = useState<'register' | 'send_otp' | null>(null);
  const [hint, setHint] = useState<InlineHint>(null);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [secondsLeft]);

  const normalizedEmail = useMemo(() => (email || '').trim().toLowerCase(), [email]);
  const emailIsValid = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail), [normalizedEmail]);
  const canResend = step === 'verify' && secondsLeft <= 0 && !sending;

  useEffect(() => {
    if (step !== 'idle') return;
    if (!emailIsValid) {
      setNextAction(null);
      return;
    }
    setNextAction(null);
    let active = true;
    const handle = window.setTimeout(async () => {
      setChecking(true);
      try {
        const res = await getGuestEmailStatus(normalizedEmail);
        if (active) setNextAction(res?.next_action === 'send_otp' ? 'send_otp' : 'register');
      } catch {
        if (active) setNextAction('register');
      } finally {
        if (active) setChecking(false);
      }
    }, 260);

    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [normalizedEmail, emailIsValid, step]);

  const sendOtp = async () => {
    if (!emailIsValid) {
      message.warning('Please enter a valid email');
      return;
    }
    setSending(true);
    try {
      await requestOtp(normalizedEmail);
      setStep('verify');
      setSecondsLeft(RESEND_SECONDS);
      setHint({ tone: 'success', text: 'Verification code sent to your email' });
    } catch (e: any) {
      const retryAfter = Number(e?.response?.data?.retry_after_seconds || 0);
      if (e?.response?.status === 429 && retryAfter > 0) {
        setStep('verify');
        setSecondsLeft(retryAfter);
        message.warning(e?.response?.data?.message || `Too many requests. Retry in ${retryAfter}s.`);
      } else {
        message.error(e?.response?.data?.detail || e?.response?.data?.message || 'Failed to send OTP');
      }
    } finally {
      setSending(false);
    }
  };

  const submitRegistration = async () => {
    if (!emailIsValid) {
      message.warning('Please enter a valid email');
      return;
    }
    setSending(true);
    try {
      const result = await registerEmail(normalizedEmail);
      if (result?.status === 'active') {
        setNextAction('send_otp');
        try {
          await requestOtp(normalizedEmail);
          setStep('verify');
          setSecondsLeft(RESEND_SECONDS);
          setHint({ tone: 'success', text: 'Account active — verification code sent to your email' });
        } catch (e: any) {
          const retryAfter = Number(e?.response?.data?.retry_after_seconds || 0);
          if (e?.response?.status === 429 && retryAfter > 0) {
            setStep('verify');
            setSecondsLeft(retryAfter);
            message.warning(e?.response?.data?.message || `Too many requests. Retry in ${retryAfter}s.`);
          } else {
            message.error(
              e?.response?.data?.detail ||
                e?.response?.data?.message ||
                'Registered, but failed to send OTP. Please try again.',
            );
          }
        }
      } else {
        setHint({ tone: 'info', text: 'A confirmation email has been sent. Check your inbox to continue.' });
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || 'Registration submit failed');
    } finally {
      setSending(false);
    }
  };

  const verify = async (values: { otp: string }) => {
    setVerifying(true);
    try {
      await verifyOtp(normalizedEmail, String(values.otp || '').trim());
      message.success(`Login succeeded: ${normalizedEmail}`);
      onLoginSuccess();
    } catch (e: any) {
      message.error(e?.response?.data?.error || e?.response?.data?.detail || 'OTP verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const goBackToEmail = () => {
    setStep('idle');
    setSecondsLeft(0);
    setHint(null);
  };

  return (
    <Form layout="vertical" className="login-form-panel" onFinish={verify} aria-live="polite">
      <Form.Item label={<span style={{ color: '#9ab8e6' }}>Email</span>} required>
        <Input
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setNextAction(null);
            setHint(null);
            if (step !== 'idle') {
              setStep('idle');
              setSecondsLeft(0);
            }
          }}
          disabled={step === 'verify'}
          prefix={<MailOutlined style={{ color: 'rgba(216, 232, 255, 0.72)' }} />}
          placeholder="you@example.com"
          autoComplete="email"
        />
      </Form.Item>

      {step === 'verify' ? (
        <>
          {hint ? (
            <div className={`otp-inline-hint otp-inline-hint-${hint.tone}`} role="status">
              {hint.tone === 'success' ? '✓ ' : ''}
              {hint.text}
            </div>
          ) : null}
          <Form.Item
            name="otp"
            className="otp-item"
            label={
              <div className="otp-label-row">
                <span style={{ color: '#9ab8e6' }}>OTP Code</span>
                {canResend ? (
                  <Button type="link" size="small" className="otp-resend-link" loading={sending} onClick={sendOtp}>
                    Resend Code
                  </Button>
                ) : (
                  <span className="otp-resend-countdown">{sending ? 'Sending…' : `Resend in ${secondsLeft}s`}</span>
                )}
              </div>
            }
            rules={[
              { required: true, message: 'Please enter OTP' },
              { pattern: /^\d{6}$/, message: 'OTP must be a 6-digit number' },
            ]}
          >
            <Input
              maxLength={6}
              autoFocus
              inputMode="numeric"
              prefix={<SafetyCertificateOutlined style={{ color: 'rgba(216, 232, 255, 0.72)' }} />}
              placeholder="123456"
            />
          </Form.Item>
        </>
      ) : null}

      {step === 'idle' ? (
        !emailIsValid ? null : checking && !nextAction ? (
          <Button block loading aria-busy>
            Checking...
          </Button>
        ) : nextAction === 'send_otp' ? (
          <Button type="primary" loading={sending || checking} onClick={sendOtp} block aria-busy={sending || checking}>
            {sending ? 'Sending OTP...' : checking ? 'Checking...' : 'Send OTP'}
          </Button>
        ) : nextAction === 'register' ? (
          <Button type="primary" loading={sending || checking} onClick={submitRegistration} block aria-busy={sending || checking}>
            {sending ? 'Registering...' : checking ? 'Checking...' : 'Register Email'}
          </Button>
        ) : null
      ) : (
        <>
          <Button type="primary" htmlType="submit" loading={verifying} block aria-busy={verifying}>
            {verifying ? 'Verifying...' : 'Verify & Login'}
          </Button>
          <div className="otp-back-row">
            <Button type="text" icon={<ArrowLeftOutlined />} className="otp-back-ghost" onClick={goBackToEmail}>
              Back
            </Button>
          </div>
        </>
      )}

      {step === 'idle' && hint ? (
        <div className={`otp-inline-hint otp-inline-hint-${hint.tone}`} role="status">
          {hint.text}
        </div>
      ) : null}

      {step === 'idle' && !emailIsValid ? (
        <Typography.Text style={{ color: '#9ab8e6' }}>Enter your email to continue</Typography.Text>
      ) : null}
    </Form>
  );
};

export default ExternalOtpForm;
