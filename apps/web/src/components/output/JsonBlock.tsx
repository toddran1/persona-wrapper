export function JsonBlock({ data }: { data: Record<string, unknown> }) {
  return <pre className="output-code">{JSON.stringify(data, null, 2)}</pre>;
}

