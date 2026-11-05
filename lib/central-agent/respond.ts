import { NextResponse } from "next/server";
import { InputError } from "./flow-template";
import { ConflictError, NotFoundError } from "./store";

/**
 * Turns what the store threw into an answer the routine can act on.
 *
 * Unexpected errors are logged by message only. The request is never
 * logged: its headers carry the key.
 */
export function errorResponse(error: unknown, where: string): NextResponse {
  if (error instanceof InputError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof ConflictError) {
    return NextResponse.json(
      { error: error.message, existing: error.existing, conflitos: error.conflitos },
      { status: 409 }
    );
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[central-agent] ${where}:`, message);
  return NextResponse.json({ error: message }, { status: 500 });
}
