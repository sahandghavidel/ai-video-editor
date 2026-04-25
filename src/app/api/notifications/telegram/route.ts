import { NextRequest, NextResponse } from 'next/server';
import {
  getTelegramConfigStatus,
  sendTelegramNotificationServer,
} from '@/server/notifications/telegram';

type TelegramNotificationRequest = {
  message?: unknown;
};

const normalizeMessage = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as TelegramNotificationRequest;
    const message = normalizeMessage(body?.message);

    if (!message) {
      return NextResponse.json(
        { success: false, error: 'Message is required' },
        { status: 400 },
      );
    }

    const result = await sendTelegramNotificationServer(message);

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: 'Telegram notification sent successfully',
      });
    }

    return NextResponse.json(
      { success: false, error: result.error || 'Failed to send notification' },
      { status: 500 },
    );
  } catch (error) {
    console.error('Error in /api/notifications/telegram:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Telegram notification API is running',
    usage: 'POST with { "message": "your message here" }',
    environment: getTelegramConfigStatus(),
  });
}
