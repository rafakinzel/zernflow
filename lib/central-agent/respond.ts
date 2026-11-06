import { NextResponse } from "next/server";
import { InputError } from "./flow-template";
import { ConflictError, NotFoundError } from "./store";
import { Recusa } from "./dm";

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

/**
 * The same, for the direct-message routes: refusals carry a Portuguese
 * `erro` and a stable `motivo` the routine can branch on.
 */
export function dmErrorResponse(error: unknown, where: string): NextResponse {
  if (error instanceof Recusa) {
    return NextResponse.json({ erro: error.message, motivo: error.motivo }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[central-agent] ${where}:`, message);
  return NextResponse.json({ erro: message, motivo: "erro_interno" }, { status: 500 });
}
