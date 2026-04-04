import { NextResponse } from 'next/server';
import type { AnyEmailFinderRequest } from '@/lib/types';

export async function POST(req: Request) {
  try {
    const { leadId, name, company, linkedinUrl, domain } = await req.json();

    if (!name || !company) {
      return NextResponse.json({ 
        success: false, 
        error: 'Name and company are required' 
      }, { status: 400 });
    }

    const apiKey = process.env.ANYMAIL_FINDER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ 
        success: false, 
        error: 'AnyEmail Finder API key is not configured' 
      }, { status: 500 });
    }

    // Preparar datos para la API
    const nameParts = name.split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ');

    let requestData: AnyEmailFinderRequest = {
      full_name: name,
      first_name: firstName,
      last_name: lastName || undefined,
    };
    
    // Estrategia de búsqueda de dominio
    if (domain) {
      requestData.domain = domain;
    } else {
      requestData.company_name = company;
    }

    // Llamar a AnyEmail Finder API
    const response = await fetch('https://api.anymailfinder.com/v5.0/search/person.json', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AnyEmail Finder API error:', errorText);
      return NextResponse.json({ 
        success: false, 
        error: 'Failed to search for email' 
      }, { status: response.status });
    }

    const result = await response.json();

    // Procesar respuesta de AnyEmail Finder
    if (result.email && result.status === 'valid') {
      return NextResponse.json({
        success: true,
        email: result.email,
        confidence: result.confidence || 0.9,
        status: result.status,
        credits_used: result.credits_used || 1,
        leadId
      });
    } else {
      return NextResponse.json({
        success: false,
        error: result.status === 'risky' 
          ? 'Email found but marked as risky' 
          : 'No valid email found',
        status: result.status,
        leadId
      });
    }

  } catch (error: any) {
    console.error('Email enrichment error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error during email enrichment' 
    }, { status: 500 });
  }
}
