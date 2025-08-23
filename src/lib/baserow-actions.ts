'use server';

export interface BaserowRow {
  id: number;
  [key: string]: unknown;
}

// Cache the JWT token for the duration of the server action
let cachedToken: string | null = null;
let tokenExpiry: number = 0;

async function getJWTToken(): Promise<string> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const email = process.env.BASEROW_EMAIL;
  const password = process.env.BASEROW_PASSWORD;

  if (!baserowUrl || !email || !password) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  // Return cached token if it's still valid (with 5 minute buffer)
  if (cachedToken && Date.now() < tokenExpiry - 300000) {
    return cachedToken;
  }

  try {
    const response = await fetch(`${baserowUrl}/user/token-auth/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Auth failed with response:', errorText);
      throw new Error(
        `Authentication failed: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const data = await response.json();
    cachedToken = data.token;
    // JWT tokens typically expire in 1 hour, cache for 50 minutes to be safe
    tokenExpiry = Date.now() + 50 * 60 * 1000;

    if (!cachedToken) {
      throw new Error('No token received from Baserow');
    }

    return cachedToken;
  } catch (error) {
    console.error('Error authenticating with Baserow:', error);
    throw error;
  }
}

export async function getBaserowData(): Promise<BaserowRow[]> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const tableId = process.env.BASEROW_TABLE_ID;

  if (!baserowUrl || !tableId) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  try {
    const token = await getJWTToken();
    const url = `${baserowUrl}/database/rows/table/${tableId}/`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `JWT ${token}`,
        'Content-Type': 'application/json',
      },
      // Disable caching for fresh data
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Data fetch failed with response:', errorText);
      throw new Error(
        `Baserow API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const data = await response.json();
    return data.results || [];
  } catch (error) {
    console.error('Error fetching Baserow data:', error);
    throw error;
  }
}

export async function createBaserowRow(
  rowData: Record<string, unknown>
): Promise<BaserowRow> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const tableId = process.env.BASEROW_TABLE_ID;

  if (!baserowUrl || !tableId) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  try {
    const token = await getJWTToken();

    const response = await fetch(
      `${baserowUrl}/database/rows/table/${tableId}/`,
      {
        method: 'POST',
        headers: {
          Authorization: `JWT ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(rowData),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Baserow API error: ${response.status} ${response.statusText}`
      );
    }

    return await response.json();
  } catch (error) {
    console.error('Error creating Baserow row:', error);
    throw error;
  }
}

export async function updateBaserowRow(
  rowId: number,
  rowData: Record<string, unknown>
): Promise<BaserowRow> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const tableId = process.env.BASEROW_TABLE_ID;

  if (!baserowUrl || !tableId) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  try {
    const token = await getJWTToken();

    const response = await fetch(
      `${baserowUrl}/database/rows/table/${tableId}/${rowId}/`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `JWT ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(rowData),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Baserow API error: ${response.status} ${response.statusText}`
      );
    }

    return await response.json();
  } catch (error) {
    console.error('Error updating Baserow row:', error);
    throw error;
  }
}

export async function deleteBaserowRow(rowId: number): Promise<void> {
  const baserowUrl = process.env.BASEROW_API_URL;
  const tableId = process.env.BASEROW_TABLE_ID;

  if (!baserowUrl || !tableId) {
    throw new Error(
      'Missing Baserow configuration. Please check your environment variables.'
    );
  }

  try {
    const token = await getJWTToken();

    const response = await fetch(
      `${baserowUrl}/database/rows/table/${tableId}/${rowId}/`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `JWT ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(
        `Baserow API error: ${response.status} ${response.statusText}`
      );
    }
  } catch (error) {
    console.error('Error deleting Baserow row:', error);
    throw error;
  }
}
