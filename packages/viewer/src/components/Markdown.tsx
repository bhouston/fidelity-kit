import ReactMarkdown from 'react-markdown';

export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert sm:prose-base">
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
