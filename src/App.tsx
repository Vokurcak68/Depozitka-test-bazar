import { useMemo, useState } from 'react'
import './App.css'

type Role = 'buyer' | 'seller' | 'admin'
type PaymentMethod = 'Escrow' | 'Převod' | 'Dobírka'
type EscrowStatus =
  | 'created'
  | 'partial_paid'
  | 'paid'
  | 'shipped'
  | 'delivered'
  | 'completed'
  | 'auto_completed'
  | 'disputed'
  | 'hold'
  | 'refunded'
  | 'cancelled'
  | 'payout_sent'
  | 'payout_confirmed'

interface User {
  id: string
  name: string
  email: string
  role: Role
}

interface Listing {
  id: string
  title: string
  price: number
  sellerId: string
  paymentMethods: PaymentMethod[]
}

interface Transaction {
  id: string
  listingId: string
  buyerName: string
  buyerEmail: string
  sellerId: string
  sellerEmail: string
  amount: number
  feePercent: number
  feeAmount: number
  payoutAmount: number
  status: EscrowStatus
  holdReason?: string
  disputeReason?: string
  createdAt: string
  updatedAt: string
}

interface EscrowEvent {
  id: string
  transactionId: string
  actorRole: Role
  actorEmail: string
  action: string
  oldStatus: EscrowStatus | '-'
  newStatus: EscrowStatus
  note?: string
  createdAt: string
}

interface EmailLog {
  id: string
  transactionId: string
  templateKey: string
  toEmail: string
  subject: string
  status: 'queued' | 'sent'
  createdAt: string
}

const statusLabel: Record<EscrowStatus, string> = {
  created: 'Vytvořeno',
  partial_paid: 'Částečně zaplaceno',
  paid: 'Zaplaceno',
  shipped: 'Odesláno',
  delivered: 'Doručeno',
  completed: 'Dokončeno',
  auto_completed: 'Auto dokončeno',
  disputed: 'Spor',
  hold: 'Hold',
  refunded: 'Refundováno',
  cancelled: 'Zrušeno',
  payout_sent: 'Výplata odeslána',
  payout_confirmed: 'Výplata potvrzena',
}

const allowedTransitions: Record<EscrowStatus, EscrowStatus[]> = {
  created: ['partial_paid', 'paid', 'cancelled'],
  partial_paid: ['paid', 'cancelled'],
  paid: ['shipped', 'disputed', 'hold', 'refunded'],
  shipped: ['delivered', 'disputed', 'hold'],
  delivered: ['completed', 'auto_completed', 'disputed', 'hold'],
  disputed: ['hold', 'refunded', 'payout_sent', 'cancelled'],
  hold: ['disputed', 'refunded', 'payout_sent', 'cancelled'],
  payout_sent: ['payout_confirmed'],
  completed: [],
  auto_completed: [],
  refunded: [],
  cancelled: [],
  payout_confirmed: [],
}

const usersSeed: User[] = [
  { id: 'u-admin', name: 'Depozitka Admin', email: 'admin@depozitka.cz', role: 'admin' },
  { id: 'u-seller-1', name: 'Kolejmaster', email: 'seller1@test.cz', role: 'seller' },
  { id: 'u-seller-2', name: 'LokoTom', email: 'seller2@test.cz', role: 'seller' },
]

const listingsSeed: Listing[] = [
  {
    id: 'l-1001',
    title: 'Tillig 74806 – nákladní vůz H0',
    price: 890,
    sellerId: 'u-seller-1',
    paymentMethods: ['Escrow', 'Převod'],
  },
  {
    id: 'l-1002',
    title: 'Piko SmartControl set + trafo',
    price: 3490,
    sellerId: 'u-seller-2',
    paymentMethods: ['Escrow', 'Dobírka'],
  },
  {
    id: 'l-1003',
    title: 'Modelová budova nádraží',
    price: 1250,
    sellerId: 'u-seller-1',
    paymentMethods: ['Převod', 'Dobírka'],
  },
]

function now() {
  return new Date().toLocaleString('cs-CZ')
}

function formatPrice(value: number) {
  return `${new Intl.NumberFormat('cs-CZ').format(value)} Kč`
}

function App() {
  const [tab, setTab] = useState<'market' | 'admin' | 'emails'>('market')
  const [users] = useState<User[]>(usersSeed)
  const [listings] = useState<Listing[]>(listingsSeed)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [events, setEvents] = useState<EscrowEvent[]>([])
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([])

  const [buyerName, setBuyerName] = useState('Testující kupující')
  const [buyerEmail, setBuyerEmail] = useState('buyer@test.cz')
  const [selectedListingId, setSelectedListingId] = useState(listingsSeed[0].id)

  const [statusChange, setStatusChange] = useState<Record<string, EscrowStatus | ''>>({})
  const [statusNote, setStatusNote] = useState<Record<string, string>>({})

  const selectedListing = listings.find((l) => l.id === selectedListingId)

  const listingsWithSeller = useMemo(
    () =>
      listings.map((listing) => ({
        ...listing,
        seller: users.find((u) => u.id === listing.sellerId),
      })),
    [listings, users],
  )

  function addEmailLog(transactionId: string, templateKey: string, toEmail: string, subject: string) {
    const log: EmailLog = {
      id: `mail-${crypto.randomUUID().slice(0, 8)}`,
      transactionId,
      templateKey,
      toEmail,
      subject,
      status: 'sent',
      createdAt: now(),
    }
    setEmailLogs((prev) => [log, ...prev])
  }

  function addEvent(
    transactionId: string,
    actorRole: Role,
    actorEmail: string,
    action: string,
    oldStatus: EscrowStatus | '-',
    newStatus: EscrowStatus,
    note?: string,
  ) {
    const event: EscrowEvent = {
      id: `ev-${crypto.randomUUID().slice(0, 8)}`,
      transactionId,
      actorRole,
      actorEmail,
      action,
      oldStatus,
      newStatus,
      note,
      createdAt: now(),
    }
    setEvents((prev) => [event, ...prev])
  }

  function createTransaction() {
    if (!selectedListing) return
    if (!selectedListing.paymentMethods.includes('Escrow')) {
      alert('Vybraný inzerát nepodporuje Escrow')
      return
    }

    if (!buyerName.trim() || !buyerEmail.trim()) {
      alert('Kupující musí mít jméno i email')
      return
    }

    const seller = users.find((u) => u.id === selectedListing.sellerId)
    if (!seller?.email) {
      alert('Prodejce musí mít email')
      return
    }

    const feePercent = 5
    const feeAmount = Math.max(15, Math.round(selectedListing.price * (feePercent / 100)))
    const payoutAmount = selectedListing.price - feeAmount

    const tx: Transaction = {
      id: `ESC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      listingId: selectedListing.id,
      buyerName: buyerName.trim(),
      buyerEmail: buyerEmail.trim(),
      sellerId: seller.id,
      sellerEmail: seller.email,
      amount: selectedListing.price,
      feePercent,
      feeAmount,
      payoutAmount,
      status: 'created',
      createdAt: now(),
      updatedAt: now(),
    }

    setTransactions((prev) => [tx, ...prev])

    addEvent(tx.id, 'buyer', tx.buyerEmail, 'transaction_created', '-', 'created')
    addEmailLog(tx.id, 'tx_created_buyer', tx.buyerEmail, `[${tx.id}] Transakce vytvořena`)
    addEmailLog(tx.id, 'tx_created_seller', tx.sellerEmail, `[${tx.id}] Nová escrow transakce`)
    addEmailLog(tx.id, 'tx_created_admin', 'admin@depozitka.cz', `[${tx.id}] Nová transakce`)
  }

  function applyStatusChange(transactionId: string) {
    const targetStatus = statusChange[transactionId]
    if (!targetStatus) return

    setTransactions((prev) =>
      prev.map((tx) => {
        if (tx.id !== transactionId) return tx

        if (!allowedTransitions[tx.status].includes(targetStatus)) {
          alert(`Přechod ${tx.status} -> ${targetStatus} není povolený`)
          return tx
        }

        const note = (statusNote[transactionId] || '').trim()

        if (targetStatus === 'hold' && !note) {
          alert('Pro stav HOLD zadej důvod')
          return tx
        }

        if (targetStatus === 'disputed' && !note) {
          alert('Pro stav SPOR zadej důvod')
          return tx
        }

        const updated: Transaction = {
          ...tx,
          status: targetStatus,
          holdReason: targetStatus === 'hold' ? note : tx.holdReason,
          disputeReason: targetStatus === 'disputed' ? note : tx.disputeReason,
          updatedAt: now(),
        }

        addEvent(transactionId, 'admin', 'admin@depozitka.cz', 'status_changed', tx.status, targetStatus, note)

        // email trigger body (phase 1)
        if (targetStatus === 'paid') {
          addEmailLog(tx.id, 'payment_received_buyer', tx.buyerEmail, `[${tx.id}] Platba přijata`)
          addEmailLog(tx.id, 'payment_received_seller', tx.sellerEmail, `[${tx.id}] Kupující zaplatil`)
        }
        if (targetStatus === 'shipped') {
          addEmailLog(tx.id, 'shipped_buyer', tx.buyerEmail, `[${tx.id}] Zboží odesláno`)
        }
        if (targetStatus === 'delivered') {
          addEmailLog(tx.id, 'delivered_buyer', tx.buyerEmail, `[${tx.id}] Zboží doručeno`)
          addEmailLog(tx.id, 'delivered_seller', tx.sellerEmail, `[${tx.id}] Zboží doručeno`)
        }
        if (targetStatus === 'completed' || targetStatus === 'auto_completed') {
          addEmailLog(tx.id, 'completed_buyer', tx.buyerEmail, `[${tx.id}] Transakce dokončena`)
          addEmailLog(tx.id, 'completed_seller', tx.sellerEmail, `[${tx.id}] Transakce dokončena`)
        }
        if (targetStatus === 'disputed') {
          addEmailLog(tx.id, 'dispute_opened_buyer', tx.buyerEmail, `[${tx.id}] Otevřen spor`)
          addEmailLog(tx.id, 'dispute_opened_seller', tx.sellerEmail, `[${tx.id}] Otevřen spor`)
          addEmailLog(tx.id, 'dispute_opened_admin', 'admin@depozitka.cz', `[${tx.id}] Nový spor`)
        }
        if (targetStatus === 'hold') {
          addEmailLog(tx.id, 'hold_set_buyer', tx.buyerEmail, `[${tx.id}] Transakce na hold`)
          addEmailLog(tx.id, 'hold_set_seller', tx.sellerEmail, `[${tx.id}] Transakce na hold`)
        }
        if (targetStatus === 'refunded') {
          addEmailLog(tx.id, 'refunded_buyer', tx.buyerEmail, `[${tx.id}] Vrácení platby`)
          addEmailLog(tx.id, 'refunded_seller', tx.sellerEmail, `[${tx.id}] Vrácení platby kupujícímu`)
        }
        if (targetStatus === 'payout_sent' || targetStatus === 'payout_confirmed') {
          addEmailLog(tx.id, 'payout_seller', tx.sellerEmail, `[${tx.id}] Výplata prodávajícímu`)
          addEmailLog(tx.id, 'payout_admin', 'admin@depozitka.cz', `[${tx.id}] Výplata zpracována`)
        }

        return updated
      }),
    )

    setStatusChange((prev) => ({ ...prev, [transactionId]: '' }))
    setStatusNote((prev) => ({ ...prev, [transactionId]: '' }))
  }

  const groups = useMemo(
    () => ({
      resolve: transactions.filter((t) => ['disputed', 'hold'].includes(t.status)),
      processing: transactions.filter((t) => ['created', 'partial_paid', 'paid', 'shipped', 'delivered'].includes(t.status)),
      closed: transactions.filter((t) =>
        ['completed', 'auto_completed', 'refunded', 'cancelled', 'payout_sent', 'payout_confirmed'].includes(t.status),
      ),
    }),
    [transactions],
  )

  return (
    <div className="app">
      <header className="topbar">
        <h1>Depozitka · Fáze 1 (core test)</h1>
        <p>Data model + status engine + admin workflow + email logy (sandbox).</p>
      </header>

      <nav className="tabs">
        <button className={tab === 'market' ? 'active' : ''} onClick={() => setTab('market')}>
          Test bazar
        </button>
        <button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}>
          Admin escrow
        </button>
        <button className={tab === 'emails' ? 'active' : ''} onClick={() => setTab('emails')}>
          Email logy
        </button>
      </nav>

      {tab === 'market' && (
        <section className="panel">
          <h2>Vytvořit transakci</h2>
          <div className="formGrid">
            <label>
              Kupující (jméno)
              <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
            </label>
            <label>
              Kupující (email)
              <input value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} type="email" />
            </label>
          </div>

          <div className="listings">
            {listingsWithSeller.map((listing) => (
              <article
                key={listing.id}
                className={`listing ${selectedListingId === listing.id ? 'active' : ''}`}
                onClick={() => setSelectedListingId(listing.id)}
              >
                <h3>{listing.title}</h3>
                <p>
                  Prodejce: <strong>{listing.seller?.name}</strong> ({listing.seller?.email})
                </p>
                <div className="row">
                  <span>{formatPrice(listing.price)}</span>
                  <span>{listing.paymentMethods.join(' · ')}</span>
                </div>
              </article>
            ))}
          </div>

          <button className="primary" onClick={createTransaction}>
            Vytvořit escrow transakci
          </button>

          <p className="hint">Escrow transakce: {transactions.length}</p>
        </section>
      )}

      {tab === 'admin' && (
        <section className="panel">
          <h2>Admin rozhraní</h2>

          <div className="groupWrap">
            <div className="group">
              <h3>K řešení ({groups.resolve.length})</h3>
              {groups.resolve.map((tx) => (
                <TxCard
                  key={tx.id}
                  tx={tx}
                  note={statusNote[tx.id] || ''}
                  change={statusChange[tx.id] || ''}
                  onNote={(v) => setStatusNote((p) => ({ ...p, [tx.id]: v }))}
                  onChange={(v) => setStatusChange((p) => ({ ...p, [tx.id]: v }))}
                  onApply={() => applyStatusChange(tx.id)}
                />
              ))}
            </div>

            <div className="group">
              <h3>V procesu ({groups.processing.length})</h3>
              {groups.processing.map((tx) => (
                <TxCard
                  key={tx.id}
                  tx={tx}
                  note={statusNote[tx.id] || ''}
                  change={statusChange[tx.id] || ''}
                  onNote={(v) => setStatusNote((p) => ({ ...p, [tx.id]: v }))}
                  onChange={(v) => setStatusChange((p) => ({ ...p, [tx.id]: v }))}
                  onApply={() => applyStatusChange(tx.id)}
                />
              ))}
            </div>

            <div className="group">
              <h3>Ukončeno ({groups.closed.length})</h3>
              {groups.closed.map((tx) => (
                <TxCard
                  key={tx.id}
                  tx={tx}
                  note={statusNote[tx.id] || ''}
                  change={statusChange[tx.id] || ''}
                  onNote={(v) => setStatusNote((p) => ({ ...p, [tx.id]: v }))}
                  onChange={(v) => setStatusChange((p) => ({ ...p, [tx.id]: v }))}
                  onApply={() => applyStatusChange(tx.id)}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {tab === 'emails' && (
        <section className="panel">
          <h2>Email logy ({emailLogs.length})</h2>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Čas</th>
                  <th>Tx</th>
                  <th>Template</th>
                  <th>Komu</th>
                  <th>Předmět</th>
                  <th>Stav</th>
                </tr>
              </thead>
              <tbody>
                {emailLogs.map((log) => (
                  <tr key={log.id}>
                    <td>{log.createdAt}</td>
                    <td>{log.transactionId}</td>
                    <td>{log.templateKey}</td>
                    <td>{log.toEmail}</td>
                    <td>{log.subject}</td>
                    <td>{log.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Audit eventy ({events.length})</h3>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Čas</th>
                  <th>Tx</th>
                  <th>Role</th>
                  <th>Email</th>
                  <th>Akce</th>
                  <th>Přechod</th>
                  <th>Poznámka</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{event.createdAt}</td>
                    <td>{event.transactionId}</td>
                    <td>{event.actorRole}</td>
                    <td>{event.actorEmail}</td>
                    <td>{event.action}</td>
                    <td>
                      {event.oldStatus} → {event.newStatus}
                    </td>
                    <td>{event.note || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

function TxCard({
  tx,
  change,
  note,
  onChange,
  onNote,
  onApply,
}: {
  tx: Transaction
  change: EscrowStatus | ''
  note: string
  onChange: (value: EscrowStatus | '') => void
  onNote: (value: string) => void
  onApply: () => void
}) {
  const nextOptions = allowedTransitions[tx.status]

  return (
    <article className="txCard">
      <div className="txHead">
        <strong>{tx.id}</strong>
        <span className={`status ${tx.status}`}>{statusLabel[tx.status]}</span>
      </div>

      <p>
        <strong>Kupující:</strong> {tx.buyerName} ({tx.buyerEmail})
      </p>
      <p>
        <strong>Prodejce:</strong> {tx.sellerEmail}
      </p>
      <p>
        <strong>Částka:</strong> {formatPrice(tx.amount)} · <strong>Provize:</strong> {formatPrice(tx.feeAmount)} ·{' '}
        <strong>Výplata:</strong> {formatPrice(tx.payoutAmount)}
      </p>

      <div className="txActions">
        <select value={change} onChange={(e) => onChange((e.target.value as EscrowStatus) || '')}>
          <option value="">Zvol nový stav</option>
          {nextOptions.map((status) => (
            <option key={status} value={status}>
              {statusLabel[status]}
            </option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => onNote(e.target.value)}
          placeholder="Důvod/poznámka (povinné pro hold/spor)"
        />
        <button className="primary" disabled={!change} onClick={onApply}>
          Potvrdit změnu
        </button>
      </div>
    </article>
  )
}

export default App
