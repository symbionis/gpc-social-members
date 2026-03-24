import { ServerClient } from "postmark";

export const postmark = new ServerClient(
  process.env.POSTMARK_SERVER_TOKEN || ""
);

const FROM_EMAIL = "juliette@genevapolo.com";

interface SendEmailOptions {
  to: string;
  templateAlias: string;
  templateModel: Record<string, unknown>;
}

export async function sendEmail({ to, templateAlias, templateModel }: SendEmailOptions) {
  try {
    await postmark.sendEmailWithTemplate({
      From: FROM_EMAIL,
      To: to,
      TemplateAlias: templateAlias,
      TemplateModel: templateModel,
    });
    return { success: true };
  } catch (error) {
    console.error(`Failed to send email (${templateAlias}) to ${to}:`, error);
    return { success: false, error };
  }
}
