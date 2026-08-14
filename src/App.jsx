import React from 'react'
import Summarizer from './components/Summarizer'

export default function App(){
  return (
    <div className="app">
      <header>
        <h1>Grayler — Meeting Notes Summarizer</h1>
        <p>Paste notes or upload text and get summary, action items and decisions.</p>
      </header>
      <main>
        <Summarizer />
      </main>
    </div>
  )
}
