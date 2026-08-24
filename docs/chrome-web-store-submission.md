# Chrome Web Store Submission: Anton.IA Automation

Use this document to complete the new Chrome Web Store listing. Do not send the extension for review until the production privacy policy has been updated to match version 3.1.

## Package

Upload this file:

`public/downloads/antonia-linkedin-extension.zip`

The ZIP contains the production Manifest V3 extension version 3.1 and has `manifest.json` at its root. It permits only LinkedIn and the production Anton.IA origin; development origins are not included in the store package.

## Store Listing

### Description

```text
Anton.IA Automation ayuda a los equipos comerciales a enviar mensajes directos de LinkedIn con más contexto y control.

Desde Anton.IA puedes revisar y editar un borrador personalizado antes de iniciar el envío. La extensión abre el perfil público indicado, escribe el mensaje directo aprobado y solo informa éxito cuando LinkedIn muestra el mensaje saliente en la conversación.

Qué hace:
- Prepara mensajes directos a partir del contexto revisado en Anton.IA.
- Permite editar cada mensaje antes de enviarlo.
- Abre únicamente el perfil público de LinkedIn seleccionado.
- Confirma visualmente el mensaje saliente antes de registrarlo en Anton.IA.

Qué no hace:
- No envía solicitudes de conexión automáticamente.
- No monitorea conversaciones de LinkedIn en segundo plano.
- No envía mensajes masivos.

La extensión requiere una sesión activa en Anton.IA y LinkedIn. El usuario inicia y confirma cada envío desde Anton.IA.
```

### Category and language

- Category: `Productivity`
- Language: `Spanish`

### Graphic assets

Use the prepared PNG files in `chrome-extension/store-assets/`.

- Store icon: `antonia-web-store-icon-128.png` (128 x 128)
- Small promotional image: `antonia-web-store-small-promo.png` (440 x 280)
- Marquee promotional image: `antonia-web-store-marquee.png` (1400 x 560)

Do not upload the source SVG files to Chrome Web Store; its form requests PNG or JPEG images. The required screenshot must be a real capture of the product, not a marketing mockup. Capture the reviewed LinkedIn message dialog at 1280 x 800 or 640 x 400, without the browser chrome.

## Dashboard Walkthrough

### 1. Store Listing

Enter the description above, choose `Productivity` and `Spanish`, then upload:

1. `chrome-extension/store-assets/antonia-web-store-icon-128.png` in **Chrome Web Store icon**.
2. A real 1280 x 800 or 640 x 400 Anton.IA message-review screenshot in **Screenshots**. Do not include browser chrome, customer names, emails, or private data.
3. `chrome-extension/store-assets/antonia-web-store-small-promo.png` in **Small promotional tile**. This is optional.
4. `chrome-extension/store-assets/antonia-web-store-marquee.png` in **Marquee promotional image**. This is optional.
5. Leave **Universal promotional video** empty.

### 2. Additional fields

1. In **Official URL**, choose the production Anton.IA property if it is listed. If it is not listed, use **Add a new site** and complete Google Search Console ownership verification before selecting it.
2. In **Homepage URL**, enter `https://studio--leadflowai-3yjcy.us-central1.hosted.app/`.
3. In **Support URL**, enter `https://studio--leadflowai-3yjcy.us-central1.hosted.app/privacy/extension` only after the revised privacy page has been deployed and verified.
4. Leave **Adult content** off.

### 3. Privacy

Use the answers and justification in the Privacy Practices section below. If Chrome asks whether data is handled, answer truthfully that the extension handles user-approved message content and selected profile URLs for app functionality only. Do not claim that no data is handled.

### 4. Distribution

Choose `Unlisted`. This gives users a store URL with the normal Chrome installation flow without listing it in public search.

### 5. Review access

Fill in the test account and test lead placeholders in Review Instructions. Reviewers must be able to reach the message review dialog without needing a personal or customer account.

## Additional Fields

Only use these after the production deployment includes the revised extension privacy policy.

- Official URL: `https://studio--leadflowai-3yjcy.us-central1.hosted.app/`
- Support URL: `https://studio--leadflowai-3yjcy.us-central1.hosted.app/privacy/extension`
- Adult content: `Off`

## Privacy Practices

Answer accurately for version 3.1:

- Remote code: `No`. All extension JavaScript is bundled in the submitted ZIP.
- Sale of user data: `No`.
- Use for advertising, creditworthiness or lending: `No`.
- Background monitoring of LinkedIn conversations: `No`.
- Automated connection invitations: `No`.

The extension handles the selected LinkedIn profile URL, the message text approved by the user, and the visible message state needed to confirm the outgoing message. Select the closest available data categories for `Website content` and `Personal communications`, and the sole purpose `App functionality`.

Use these permission justifications:

- `tabs`: Lets the extension find or open the requested public LinkedIn profile and return the user to the appropriate tab.
- `https://www.linkedin.com/*`: Required only for the explicit direct-message flow on the selected LinkedIn public profile.
- Anton.IA application origins: Required to receive the explicit user request and return a confirmation result to the Anton.IA page.

## Distribution

Choose `Unlisted` for the first release. It provides a Chrome Web Store installation link without making the extension searchable in the store.

## Review Instructions

Chrome reviewers need a real Anton.IA test account and a preloaded lead with a public LinkedIn profile. Replace the placeholders before submitting:

```text
1. Open https://studio--leadflowai-3yjcy.us-central1.hosted.app/ and sign in with:
   Email: REVIEWER_TEST_EMAIL
   Password: REVIEWER_TEST_PASSWORD
2. Open Guardados > Leads > Enriquecidos.
3. Open the lead named REVIEWER_TEST_LEAD, which includes a public LinkedIn profile URL.
4. Choose “Contactar por LinkedIn”.
5. Review the message and choose “Enviar mensaje directo”.

The extension only works when the reviewer is signed in to a LinkedIn test account that can send a direct message to the configured test lead. It does not automate connection invitations, bulk sends or background conversation monitoring.
```

## Required Before Submission

- Update and deploy `src/app/privacy/extension/page.tsx`.
- Confirm `https://studio--leadflowai-3yjcy.us-central1.hosted.app/privacy/extension` shows the version 3.1 policy.
- Create a reviewer-safe Anton.IA account and a test lead. Never provide a personal account or a real customer lead.
- Fill every required field, save the draft, and use “Why can't I submit?” to resolve remaining dashboard validation items.
