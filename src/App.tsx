import { useMemo, useState } from 'react'
import './App.css'

type PaymentMethod = 'Escrow' | 'Převod' | 'Dobírka'
type EscrowStatus =
  | 'created'
  | 'paid'
  | 'shipped'
  | 'delivered'
  | 'completed'
  | 'disputed'

interface Listing {
  id: string
  title: string
  price: number
  seller: string
  condition: 'Nové' | 'Jako nové' | 'Použité'
  paymentMethods: PaymentMethod[]
}

interface Transaction {
  id: string
  listingId: string
  buyer: string
  seller: string
  amount: number
  status: EscrowStatus
  createdAt: string
}

const listingsSeed: Listing[] = [
  {
    id: 'l-1001',
    title: 'Tillig 74806 – nákladní vůz H0',
    price: 890,
    seller: 'Kolejmaster',
    condition: 'Jako nové',
    paymentMethods: ['Escrow', 'Převod'],
  },
  {
    id: 'l-1002',
    title: 'Piko SmartControl set + trafo',
    price: 3490,
    seller: 'LokoTom',
    condition: 'Použité',
    paymentMethods: ['Escrow', 'Dobírka'],
  },
  {
    id: 'l-1003',
    title: 'Modelová budova nádraží (ruční stavba)',
    price: 1250,
    seller: 'BrnoRails',
    condition: 'Nové',
    paymentMethods: ['Převod', 'Dobírka'],
  },
]

const statusLabel: Record<EscrowStatus, string> = {
  created: 'Vytvořeno',
  paid: 'Zaplaceno',
  shipped: 'Odesláno',
  delivered: 'Doručeno',
  completed: 'Dokončeno',
  disputed: 'Spor',
}

const nextStatus: Partial<Record<EscrowStatus, EscrowStatus>> = {
  created: 'paid',
  paid: 'shipped',
  shipped: 'delivered',
  delivered: 'completed',
}

function formatPrice(value: number) {
  return `${new Intl.NumberFormat('cs-CZ').format(value)} Kč`
}

function App() {
  const [listings] = useState<Listing[]>(listingsSeed)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [buyerName, setBuyerName] = useState('Testující kupující')
  const [selectedListingId, setSelectedListingId] = useState(listingsSeed[0].id)
  const [filter, setFilter] = useState<'all' | 'escrow'>('all')

  const filteredListings = useMemo(() => {
    if (filter === 'all') return listings
    return listings.filter((l) => l.paymentMethods.includes('Escrow'))
  }, [filter, listings])

  function createEscrowTransaction(listing: Listing) {
    const tx: Transaction = {
      id: `tx-${crypto.randomUUID().slice(0, 8)}`,
      listingId: listing.id,
      buyer: buyerName || 'Anonymní kupující',
      seller: listing.seller,
      amount: listing.price,
      status: 'created',
      createdAt: new Date().toLocaleString('cs-CZ'),
    }

    setTransactions((prev) => [tx, ...prev])
  }

  function advanceStatus(id: string) {
    setTransactions((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t
        const next = nextStatus[t.status]
        return next ? { ...t, status: next } : t
      }),
    )
  }

  function setDispute(id: string) {
    setTransactions((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: 'disputed' } : t)),
    )
  }

  const selectedListing = listings.find((l) => l.id === selectedListingId)

  return (
    <div className="app">
      <header className="topbar">
        <h1>Depozitka · Test bazar</h1>
        <p>Jednoduché sandbox prostředí pro test flow Bezpečné platby mimo Lokopolis.</p>
      </header>

      <main className="layout">
        <section className="panel">
          <div className="panelHead">
            <h2>Inzeráty</h2>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as 'all' | 'escrow')}
            >
              <option value="all">Všechny</option>
              <option value="escrow">Jen s Escrow</option>
            </select>
          </div>

          <div className="listings">
            {filteredListings.map((listing) => {
              const supportsEscrow = listing.paymentMethods.includes('Escrow')
              return (
                <article
                  key={listing.id}
                  className={`listing ${selectedListingId === listing.id ? 'active' : ''}`}
                  onClick={() => setSelectedListingId(listing.id)}
                >
                  <div>
                    <h3>{listing.title}</h3>
                    <p>
                      {listing.condition} · Prodejce: <strong>{listing.seller}</strong>
                    </p>
                    <div className="chips">
                      {listing.paymentMethods.map((m) => (
                        <span key={m} className={`chip ${m === 'Escrow' ? 'escrow' : ''}`}>
                          {m}
                        </span>
                      ))}
                    </div>
                  </div>
                  <strong>{formatPrice(listing.price)}</strong>
                  {!supportsEscrow && (
                    <small className="warn">Tenhle inzerát nemá Escrow</small>
                  )}
                </article>
              )
            })}
          </div>
        </section>

        <section className="panel">
          <h2>Vytvořit test transakci</h2>
          {selectedListing ? (
            <div className="createBox">
              <label>
                Kupující
                <input
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  placeholder="Jméno kupujícího"
                />
              </label>

              <div className="summary">
                <p>
                  <strong>Inzerát:</strong> {selectedListing.title}
                </p>
                <p>
                  <strong>Cena:</strong> {formatPrice(selectedListing.price)}
                </p>
                <p>
                  <strong>Prodejce:</strong> {selectedListing.seller}
                </p>
              </div>

              <button
                disabled={!selectedListing.paymentMethods.includes('Escrow')}
                onClick={() => createEscrowTransaction(selectedListing)}
              >
                Spustit Escrow test
              </button>
            </div>
          ) : (
            <p>Vyber inzerát vlevo.</p>
          )}
        </section>
      </main>

      <section className="panel transactions">
        <h2>Escrow transakce</h2>
        {transactions.length === 0 ? (
          <p className="empty">Zatím nic. Vytvoř první test transakci.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Kupující</th>
                <th>Prodejce</th>
                <th>Částka</th>
                <th>Stav</th>
                <th>Vytvořeno</th>
                <th>Akce</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => {
                const canAdvance = Boolean(nextStatus[tx.status])
                return (
                  <tr key={tx.id}>
                    <td>{tx.id}</td>
                    <td>{tx.buyer}</td>
                    <td>{tx.seller}</td>
                    <td>{formatPrice(tx.amount)}</td>
                    <td>
                      <span className={`status ${tx.status}`}>{statusLabel[tx.status]}</span>
                    </td>
                    <td>{tx.createdAt}</td>
                    <td className="actions">
                      <button disabled={!canAdvance} onClick={() => advanceStatus(tx.id)}>
                        Další stav
                      </button>
                      <button
                        className="danger"
                        disabled={tx.status === 'completed' || tx.status === 'disputed'}
                        onClick={() => setDispute(tx.id)}
                      >
                        Spor
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

export default App
