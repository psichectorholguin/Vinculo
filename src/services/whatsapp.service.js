// WhatsApp Cloud API (Meta). Los mensajes iniciados por la empresa DEBEN usar
// plantillas aprobadas previamente en Meta Business Manager.
const { WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_API_VERSION = 'v20.0' } = process.env;

// Nombres de plantilla a crear/aprobar en Meta (idioma: es). Variables {{1}}..{{n}}.
export const TEMPLATES = {
  // {{1}} nombre destinatario, {{2}} contraparte, {{3}} fecha, {{4}} hora, {{5}} modalidad
  CONFIRMED_PATIENT:      'psicohoy_cita_confirmada_paciente',
  CONFIRMED_PSYCHOLOGIST: 'psicohoy_cita_confirmada_psicologo',
  REMINDER_24H:           'psicohoy_recordatorio_24h',
  REMINDER_1H:            'psicohoy_recordatorio_1h',
};

export async function sendWhatsAppTemplate({ to, template, params }) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) throw new Error('WhatsApp no configurado');
  const res = await fetch(`https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: to.replace(/[^\d]/g, ''),
      type: 'template',
      template: {
        name: template,
        language: { code: 'es' },
        components: [{ type: 'body', parameters: params.map(text => ({ type: 'text', text: String(text) })) }],
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `WhatsApp HTTP ${res.status}`);
  return data.messages?.[0]?.id;
}
