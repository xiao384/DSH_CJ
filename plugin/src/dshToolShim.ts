// Helpers to adapt our JSON-Schema-style tool definitions to DSH's defineTool
// parameter/output shape.

/** Convert a JSON-Schema-ish parameters object to DSH's { name: {type,required} } form. */
export function toDshParameters(schema: any): Record<string, { type: string; required: boolean; description: string }> {
  const props: Record<string, any> = schema?.properties ?? {};
  const required: string[] = schema?.required ?? [];
  const out: Record<string, { type: string; required: boolean; description: string }> = {};
  for (const [key, val] of Object.entries(props)) {
    const v = val as any;
    out[key] = {
      type: v.type ?? 'string',
      required: required.includes(key),
      description: v.description ?? '',
    };
  }
  return out;
}

/** What a browser tool returns; fed into defineTool's execute(). */
export interface ToolReturn {
  text?: string;
  imageBase64?: string;
  mime?: string;
}

/** Render a ToolReturn into DSH content parts (text + optional image). */
export function renderOutput(v: ToolReturn): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  if (v.text) parts.push({ type: 'text', text: v.text });
  if (v.imageBase64) {
    parts.push({ type: 'image', data: v.imageBase64, mimeType: v.mime ?? 'image/png' });
  }
  if (!parts.length) parts.push({ type: 'text', text: '(no output)' });
  return parts;
}
