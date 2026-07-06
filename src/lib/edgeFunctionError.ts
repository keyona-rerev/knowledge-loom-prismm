// supabase-js's FunctionsHttpError.message is always a generic "Edge
// Function returned a non-2xx status code" -- it never surfaces the actual
// JSON body the function sent back. Every edge function in this app returns
// a real { error: "..." } body on failure, so this pulls that out instead of
// showing the generic message whenever it's readable.
export async function describeInvokeError(error: any, fallback = "Unknown error"): Promise<string> {
  if (!error) return fallback;
  try {
    const body = await error.context?.json?.();
    if (body?.error) return String(body.error);
  } catch {
    // context wasn't readable JSON -- fall through to the generic message
  }
  return error.message || fallback;
}
