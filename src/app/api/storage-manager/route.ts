import { NextRequest, NextResponse } from 'next/server';
import { deletePreviewedFile, previewStorage, renewStorageApproval, StorageApprovalExpiredError } from '@/lib/storage-manager-server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  // Mutation requests must originate from this application.
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin && origin !== `${request.nextUrl.protocol}//${request.headers.get('host')}`) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }
  try {
    const body = await request.json();
    if (body.action === 'preview' && typeof body.keywords === 'string') {
      return NextResponse.json({ groups: await previewStorage(body.keywords) });
    }
    if (body.action === 'delete' && typeof body.token === 'string' && body.token.length <= 20_000) {
      return NextResponse.json({ result: await deletePreviewedFile(body.token) });
    }
    if (body.action === 'renew' && typeof body.token === 'string' && body.token.length <= 20_000) {
      return NextResponse.json(renewStorageApproval(body.token));
    }
    return NextResponse.json({ error: 'Invalid storage request.' }, { status: 400 });
  } catch (error) {
    if (error instanceof StorageApprovalExpiredError) {
      return NextResponse.json({ error: error.message, code: 'APPROVAL_EXPIRED' }, { status: 409 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Storage request failed.' }, { status: 400 });
  }
}
