import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import Navbar from '../components/Navbar'
import content from '../content/methodology.md?raw'

const components = {
  h1: ({ children }) => (
    <h1 className="text-3xl font-bold text-white mb-4 mt-8 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-xl font-semibold text-white mb-3 mt-8">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-lg font-medium text-gray-200 mb-2 mt-6">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="text-gray-300 leading-relaxed mb-4">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc list-inside text-gray-300 mb-4 space-y-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal list-inside text-gray-300 mb-4 space-y-1">{children}</ol>
  ),
  li: ({ children }) => <li className="text-gray-300">{children}</li>,
  strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
  em: ({ children }) => <em className="text-gray-200 italic">{children}</em>,
  code: ({ inline, children }) =>
    inline ? (
      <code className="bg-gray-800 text-blue-300 px-1.5 py-0.5 rounded text-sm font-mono">
        {children}
      </code>
    ) : (
      <code className="block bg-gray-800 text-gray-200 p-4 rounded-lg text-sm font-mono overflow-x-auto mb-4">
        {children}
      </code>
    ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-blue-600 pl-4 text-gray-400 italic my-4">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-gray-700 my-8" />,
}

export default function MethodologyPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Navbar />
      <div className="max-w-3xl mx-auto p-6">
        <ReactMarkdown
          remarkPlugins={[remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={components}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  )
}
