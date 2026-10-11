// Proveedor: Resend (https://resend.com). Cambia solo esta función para usar otro (SES, Postmark...).
const { RESEND_API_KEY, EMAIL_FROM } = process.env;

export async function sendEmail({ to, subject, text }) {
  if (!RESEND_API_KEY) throw new Error('Email no configurado');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to, subject, text }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Email HTTP ${res.status}`);
  return data.id;
}
