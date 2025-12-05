import { NextRequest, NextResponse } from "next/server";
import { contactedLeadsStorage } from "@/lib/services/contacted-leads-service";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (id) {
        // Fire and forget update (awaiting it is fine too, but we prioritize returning the image)
        await contactedLeadsStorage.markOpenedById(id);
    }

    // Transparent 1x1 PNG pixel
    const pixel = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        "base64"
    );

    return new NextResponse(pixel, {
        headers: {
            "Content-Type": "image/png",
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
        },
    });
}
