import { NextRequest, NextResponse } from 'next/server';
import { sendTelegramNotification } from '@/utils/telegram';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message } = body;

    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    console.log(
      `📤 Sending Telegram notification: "${message.substring(0, 100)}${
        message.length > 100 ? '...' : ''
      }"`
    );

    const result = await sendTelegramNotification(message);

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: 'Telegram notification sent successfully',
      });
    } else {
      return NextResponse.json(
        { error: result.error || 'Failed to send notification' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error in Telegram notification route:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Optional: GET endpoint to test the route
export async function GET() {
  return NextResponse.json({
    message: 'Telegram notification API is running',
    usage: 'POST with { "message": "your message here" }',
    environment: {
      botTokenConfigured:
        (process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN ||
          'YOUR_BOT_TOKEN_HERE') !== 'YOUR_BOT_TOKEN_HERE',
      chatId: process.env.NEXT_PUBLIC_TELEGRAM_CHAT_ID || 'Not Set',
    },
  });
}
