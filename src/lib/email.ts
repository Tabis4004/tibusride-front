export async function sendPasswordResetEmail(input: {
  to: string;
  resetUrl: string;
}) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim() ?? "Tibus Ride <onboarding@resend.dev>";

  if (!apiKey) {
    return { sent: false as const, reason: "no_email_provider" as const };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: "Réinitialisation de votre mot de passe — Tibus Ride",
      html: `
        <p>Bonjour,</p>
        <p>Cliquez sur le lien ci-dessous pour choisir un nouveau mot de passe (valide 1 h) :</p>
        <p><a href="${input.resetUrl}">${input.resetUrl}</a></p>
        <p>Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.</p>
      `,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Envoi email échoué (${res.status}) : ${body.slice(0, 200)}`);
  }

  return { sent: true as const };
}
