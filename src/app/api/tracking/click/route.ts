import { NextRequest, NextResponse } from "next/server";
import { contactedLeadsStorage } from "@/lib/services/contacted-leads-service";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const url = searchParams.get("url");

    if (id && url) {
        // Record click asynchronously
        contactedLeadsStorage.markClickedById(id).catch(err => console.error("Tracking error:", err));
    }

    // Redirect to the original URL (or fallback to homepage if missing)
    const destination = url || "/";

    // Use 307 Temporary Redirect to preserve method/body if any (though GET here)
    return NextResponse.redirect(destination, 307);
}
