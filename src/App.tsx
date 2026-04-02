import { useMemo, useState } from 'react'
import './App.css'

type PaymentMethod = 'Escrow' | 'Převod' | 'Dobírka'
type TxStatus = 'created' | 'paid' | 'shipped' | 'delivered' | 'completed' | 'disputed'

interface Listing {
  id: string
  title: string
  price: number
  sellerName: string
  sellerEmail: string
  paymentMethods: PaymentMethod[]
}

interface MarketplaceTx {
  id: string
  listingId: string
  buyerName: string
  buyerEmail: string
  sellerEmail: string
  amount: number
  status: TxStatus
  depozitkaTxId?: string
  createdAt: string
}

const listingsSeed: Listing[] = [
  {
    id: 'l-1001',
    title: 'Tillig 74806 – nákladní vůz H0',
    price: 890,
    sellerName: 'Kolejmaster',
    sellerEmail: 'seller1@test.cz',
    paymentMethods: ['Escrow', 'Převod'],
  },
  {
    id: 'l-1002',
    title: 'Piko SmartControl set + trafo',
    price: 3490,
    sellerName: 'LokoTom',
    sellerEmail: 'seller2@test.cz',
    paymentMethods: ['Escrow', 'Dobírka'],
  },
  {
    id: 'l-1003',
    title: 'Modelová budova nádraží',
    price: 1250,
    sellerName: 'ModelKing',
    sellerEmail: 'seller3@test.cz',
    paymentMethods: ['Převod', 'Dobírka'],
  },
]

function now() {
  return new Date().toLocaleString('cs-CZ')
}

function formatPrice(value: number) {
  return `${new Intl.NumberFormat('cs-CZ').format(value)} Kč`
}

function fakeDepozitkaCreate(payload: {
  buyerEmail: string
  sellerEmail: string
  amount: number
}) {
  return {
    depozitkaTxId: `DPT-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`,
    status: 'created' as TxStatus,
    acceptedAt: now(),
    payload,
  }
}

function App() {
  const [listings] = useState(listingsSeed)
  const [buyerName, setBuyerName] = useState('Testující kupující')
  const [buyerEmail, setBuyerEmail] = useState('buyer@test.cz')
  const [selectedListingId, setSelectedListingId] = useState(listingsSeed[0].id)

  const [orders, setOrders] = useState<MarketplaceTx[]>([])
  const [connectorLogs, setConnectorLogs] = useState<string[]>([])

  const selectedListing = listings.find((l) => l.id === selectedListingId)

  const escrowListings = useMemo(
    () => listings.filter((l) => l.paymentMethods.includes('Escrow')),
    [listings],
  )

  function createOrderWithEscrow() {
    if (!selectedListing) return
    if (!selectedListing.paymentMethods.includes('Escrow')) {
      alert('Tenhle inzerát nemá Escrow')
      return
    }
    if (!buyerName.trim() || !buyerEmail.trim()) {
      alert('Vyplň jméno a email kupujícího')
      return
    }

    const depozitkaResponse = fakeDepozitkaCreate({
      buyerEmail: buyerEmail.trim(),
      sellerEmail: selectedListing.sellerEmail,
      amount: selectedListing.price,
    })

    const order: MarketplaceTx = {
      id: `ORD-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      listingId: selectedListing.id,
      buyerName: buyerName.trim(),
      buyerEmail: buyerEmail.trim(),
      sellerEmail: selectedListing.sellerEmail,
      amount: selectedListing.price,
      status: 'created',
      depozitkaTxId: depozitkaResponse.depozitkaTxId,
      createdAt: now(),
    }

    setOrders((prev) => [order, ...prev])
    setConnectorLogs((prev) => [
      `[${depozitkaResponse.acceptedAt}] POST /depozitka/transactions -> ${depozitkaResponse.depozitkaTxId} (buyer=${buyerEmail.trim()}, seller=${selectedListing.sellerEmail}, amount=${selectedListing.price})`,
      ...prev,
    ])
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>Test bazar (oddělený klient)</h1>
        <p>
          Tohle je jen marketplace klient. Depozitka admin + stavy běží samostatně v projektu
          <strong> depozitka-core</strong>.
        </p>
      </header>

      <section className="panel">
        <h2>Vytvoření objednávky s Escrow</h2>

        <div className="formGrid">
          <label>
            Kupující (jméno)
            <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
          </label>
          <label>
            Kupující (email)
            <input type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} />
          </label>
        </div>

        <div className="listings">
          {escrowListings.map((listing) => (
            <article
              key={listing.id}
              className={`listing ${selectedListingId === listing.id ? 'active' : ''}`}
              onClick={() => setSelectedListingId(listing.id)}
            >
              <h3>{listing.title}</h3>
              <p>
                Prodejce: <strong>{listing.sellerName}</strong> ({listing.sellerEmail})
              </p>
              <div className="row">
                <span>{formatPrice(listing.price)}</span>
                <span>{listing.paymentMethods.join(' · ')}</span>
              </div>
            </article>
          ))}
        </div>

        <button className="primary" onClick={createOrderWithEscrow}>
          Vytvořit objednávku + zavolat Depozitku
        </button>
      </section>

      <section className="panel">
        <h2>Objednávky v bazaru ({orders.length})</h2>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Depozitka Tx</th>
                <th>Kupující</th>
                <th>Prodávající</th>
                <th>Částka</th>
                <th>Stav</th>
                <th>Čas</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>{order.id}</td>
                  <td>{order.depozitkaTxId}</td>
                  <td>{order.buyerEmail}</td>
                  <td>{order.sellerEmail}</td>
                  <td>{formatPrice(order.amount)}</td>
                  <td>{order.status}</td>
                  <td>{order.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>Konektor logy (marketplace → Depozitka)</h2>
        <div className="logs">
          {connectorLogs.length === 0 && <p>Zatím bez volání API.</p>}
          {connectorLogs.map((line, i) => (
            <pre key={`${line}-${i}`}>{line}</pre>
          ))}
        </div>
      </section>
    </div>
  )
}

export default App
