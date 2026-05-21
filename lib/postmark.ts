import { ServerClient } from "postmark";

/** Transactional sender. Event messages reuse this (not the broadcast stream). */
export const FROM_EMAIL = '"Geneva Polo Social Club" <social@genevapolo.com>';

let _client: ServerClient | null = null;

function getClient(): ServerClient {
  if (!_client) {
    if (!process.env.POSTMARK_SERVER_TOKEN) {
      throw new Error("POSTMARK_SERVER_TOKEN is not set");
    }
    _client = new ServerClient(process.env.POSTMARK_SERVER_TOKEN);
  }
  return _client;
}

export function getPostmarkClient(): ServerClient {
  return getClient();
}

interface SendEmailOptions {
  to: string;
  templateAlias: string;
  templateModel: Record<string, unknown>;
}

export async function sendEmail({ to, templateAlias, templateModel }: SendEmailOptions) {
  try {
    await getClient().sendEmailWithTemplate({
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
