import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AuthChangeEvent, Session, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import './App.css'
import { supabase } from './lib/supabase'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

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

interface Listing {
  id: string
  title: string
  price: number
  sellerName: string
  sellerEmail: string
  paymentMethods: PaymentMethod[]
}

interface MarketplaceOrder {
  id: string
  listingId: string
  listingTitle: string
  buyerName: string
  buyerEmail: string
  sellerName: string
  sellerEmail: string
  amount: number
  localStatus: string
  depozitkaTxCode: string
  depozitkaStatus: EscrowStatus
  createdAt: string
  updatedAt: string
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const MARKETPLACE_CODE = 'depozitka-test-bazar'

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

/** Map Depozitka escrow status → marketplace-level status label */
function marketplaceStatus(depStatus: EscrowStatus): string {
  switch (depStatus) {
    case 'created':
    case 'partial_paid':
      return 'Čeká na platbu'
    case 'paid':
      return 'Zaplaceno — čeká odeslání'
    case 'shipped':
      return 'Odesláno'
    case 'delivered':
      return 'Doručeno — čeká potvrzení'
    case 'completed':
    case 'auto_completed':
    case 'payout_sent':
    case 'payout_confirmed':
      return 'Dokončeno ✅'
    case 'disputed':
      return 'Spor ⚠️'
    case 'hold':
      return 'Pozastaveno'
    case 'refunded':
      return 'Vráceno'
    case 'cancelled':
      return 'Zrušeno'
  }
}

function formatPrice(value: number) {
  return `${new Intl.NumberFormat('cs-CZ').format(value)} Kč`
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('cs-CZ')
}

function generateOrderId() {
  return `ORD-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

function App() {
  // Auth
  const [sessionEmail, setSessionEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isAuthed, setIsAuthed] = useState(false)
  const [busy, setBusy] = useState(false)

  // Marketplace
  const [listings] = useState(listingsSeed)
  const [buyerName, setBuyerName] = useState('Testující kupující')
  const [buyerEmail, setBuyerEmail] = useState('buyer@test.cz')
  const [selectedListingId, setSelectedListingId] = useState(listingsSeed[0].id)
  const [orders, setOrders] = useState<MarketplaceOrder[]>([])
  const [connectorLogs, setConnectorLogs] = useState<string[]>([])

  const selectedListing = listings.find((l) => l.id === selectedListingId)
  const escrowListings = useMemo(
    () => listings.filter((l) => l.paymentMethods.includes('Escrow')),
    [listings],
  )

  // ---- Auth lifecycle ----
  useEffect(() => {
    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      setSessionEmail(data.session?.user?.email || '')
      setIsAuthed(Boolean(data.session))
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      setSessionEmail(session?.user?.email || '')
      setIsAuthed(Boolean(session))
    })
    return () => subscription.unsubscribe()
  }, [])

  // ---- Fetch orders from Depozitka ----
  const fetchOrders = useCallback(async () => {
    setBusy(true)
    const ts = new Date().toLocaleString('cs-CZ')

    const { data, error } = await supabase
      .from('dpt_transactions')
      .select(
        'id, transaction_code, external_order_id, listing_id, listing_title, buyer_name, buyer_email, seller_name, seller_email, amount_czk, status, created_at, updated_at',
      )
      .eq('marketplace_code', MARKETPLACE_CODE)
      .order('created_at', { ascending: false })
      .limit(100)

    setBusy(false)

    if (error) {
      addLog(`[${ts}] ❌ GET dpt_transactions failed: ${error.message}`)
      return
    }

    interface TxRow {
      id: string
      transaction_code: string
      external_order_id: string | null
      listing_id: string | null
      listing_title: string | null
      buyer_name: string
      buyer_email: string
      seller_name: string
      seller_email: string
      amount_czk: number
      status: EscrowStatus
      created_at: string
      updated_at: string
    }

    const mapped: MarketplaceOrder[] = ((data || []) as TxRow[]).map((row) => ({
      id: row.external_order_id || row.id,
      listingId: row.listing_id || '-',
      listingTitle: row.listing_title || '-',
      buyerName: row.buyer_name,
      buyerEmail: row.buyer_email,
      sellerName: row.seller_name,
      sellerEmail: row.seller_email,
      amount: Number(row.amount_czk),
      localStatus: marketplaceStatus(row.status),
      depozitkaTxCode: row.transaction_code,
      depozitkaStatus: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))

    setOrders(mapped)
    addLog(`[${ts}] ✅ GET dpt_transactions → ${mapped.length} objednávek načteno`)
  }, [])

  // Fetch on auth
  useEffect(() => {
    if (isAuthed) void fetchOrders()
  }, [isAuthed, fetchOrders])

  // ---- Realtime subscription ----
  useEffect(() => {
    if (!isAuthed) return

    const channel = supabase
      .channel('bazar-tx-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'dpt_transactions',
          filter: `marketplace_code=eq.${MARKETPLACE_CODE}`,
        },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          const ts = new Date().toLocaleString('cs-CZ')
          const rec = payload.new as Record<string, unknown> | undefined
          if (rec) {
            addLog(
              `[${ts}] 🔔 Realtime: ${payload.eventType} tx=${rec['transaction_code'] || rec['id']} → status=${rec['status']}`,
            )
          }
          void fetchOrders()
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [isAuthed, fetchOrders])

  // ---- Helpers ----
  function addLog(line: string) {
    setConnectorLogs((prev) => [line, ...prev].slice(0, 200))
  }

  async function signIn() {
    if (!sessionEmail || !password) {
      alert('Vyplň email a heslo')
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: sessionEmail,
      password,
    })
    setBusy(false)
    if (error) {
      alert(`Login chyba: ${error.message}`)
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setOrders([])
    setConnectorLogs([])
  }

  // ---- Create order via Depozitka RPC ----
  async function createOrderWithEscrow() {
    if (!selectedListing) return
    if (!selectedListing.paymentMethods.includes('Escrow')) {
      alert('Tenhle inzerát nemá Escrow')
      return
    }
    if (!buyerName.trim() || !buyerEmail.trim()) {
      alert('Vyplň jméno a email kupujícího')
      return
    }

    const orderId = generateOrderId()
    const ts = new Date().toLocaleString('cs-CZ')

    addLog(
      `[${ts}] → POST dpt_create_transaction (order=${orderId}, listing=${selectedListing.id}, amount=${selectedListing.price})`,
    )

    setBusy(true)
    const { data, error } = await supabase.rpc('dpt_create_transaction', {
      p_marketplace_code: MARKETPLACE_CODE,
      p_external_order_id: orderId,
      p_listing_id: selectedListing.id,
      p_listing_title: selectedListing.title,
      p_buyer_name: buyerName.trim(),
      p_buyer_email: buyerEmail.trim(),
      p_seller_name: selectedListing.sellerName,
      p_seller_email: selectedListing.sellerEmail,
      p_amount_czk: selectedListing.price,
      p_payment_method: 'escrow',
      p_metadata: { source: MARKETPLACE_CODE },
    })
    setBusy(false)

    const ts2 = new Date().toLocaleString('cs-CZ')

    if (error) {
      addLog(`[${ts2}] ❌ dpt_create_transaction failed: ${error.message}`)
      alert(`Vytvoření transakce selhalo: ${error.message}`)
      return
    }

    addLog(
      `[${ts2}] ✅ dpt_create_transaction → tx_code=${(data as Record<string, string>)?.transaction_code || 'ok'}`,
    )

    // Refresh orders from Depozitka
    await fetchOrders()
  }

  // ---- Render ----
  return (
    <div className="app">
      <header className="topbar">
        <h1>🛒 Test Bazar</h1>
        <p>
          Marketplace klient propojený s <strong>Depozitkou</strong> — stavy se synchronizují z{' '}
          <code>dpt_transactions</code> v reálném čase.
        </p>
      </header>

      {!isAuthed ? (
        <section className="panel">
          <h2>Přihlášení</h2>
          <p className="hint">Přihlas se stejným účtem jako v Depozitka Core.</p>
          <div className="formGrid">
            <label>
              Email
              <input
                type="email"
                value={sessionEmail}
                onChange={(e) => setSessionEmail(e.target.value)}
              />
            </label>
            <label>
              Heslo
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          </div>
          <button className="primary" disabled={busy} onClick={signIn}>
            {busy ? 'Přihlašuji…' : 'Přihlásit'}
          </button>
        </section>
      ) : (
        <>
          <section className="panel">
            <div className="adminTopActions">
              <strong>Přihlášen: {sessionEmail}</strong>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="ghost" onClick={() => void fetchOrders()} disabled={busy}>
                  🔄 Obnovit stavy
                </button>
                <button className="ghost" onClick={() => void signOut()} disabled={busy}>
                  Odhlásit
                </button>
              </div>
            </div>
          </section>

          <div className="syncBanner">
            🔗 Tento bazar je propojený s <strong>Depozitkou</strong> — objednávky + stavy se
            čtou živě z <code>dpt_transactions</code>. Změň stav v Depozitka Core → tady se
            automaticky aktualizuje.
          </div>

          {/* Create order */}
          <section className="panel">
            <h2>Nová objednávka s Escrow</h2>

            <div className="formGrid">
              <label>
                Kupující (jméno)
                <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
              </label>
              <label>
                Kupující (email)
                <input
                  type="email"
                  value={buyerEmail}
                  onChange={(e) => setBuyerEmail(e.target.value)}
                />
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

            <button
              className="primary"
              onClick={() => void createOrderWithEscrow()}
              disabled={busy}
            >
              {busy ? 'Vytvářím…' : 'Vytvořit objednávku → Depozitka'}
            </button>
          </section>

          {/* Orders table */}
          <section className="panel">
            <h2>Objednávky ({orders.length})</h2>
            {orders.length === 0 ? (
              <p className="hint">Zatím žádné objednávky. Vytvoř první výše ☝️</p>
            ) : (
              <div className="tableWrap">
                <table>
                  <thead>
                    <tr>
                      <th>Order ID</th>
                      <th>Inzerát</th>
                      <th>Depozitka Tx</th>
                      <th>Kupující</th>
                      <th>Prodávající</th>
                      <th>Částka</th>
                      <th>Stav v bazaru</th>
                      <th>Depozitka stav</th>
                      <th>Aktualizováno</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order.depozitkaTxCode}>
                        <td>{order.id}</td>
                        <td>{order.listingTitle}</td>
                        <td>
                          <code>{order.depozitkaTxCode}</code>
                        </td>
                        <td>
                          {order.buyerName}
                          <br />
                          <small>{order.buyerEmail}</small>
                        </td>
                        <td>
                          {order.sellerName}
                          <br />
                          <small>{order.sellerEmail}</small>
                        </td>
                        <td>{formatPrice(order.amount)}</td>
                        <td>{order.localStatus}</td>
                        <td>
                          <span className={`status ${order.depozitkaStatus}`}>
                            {statusLabel[order.depozitkaStatus]}
                          </span>
                        </td>
                        <td>{formatDate(order.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Connector logs */}
          <section className="panel">
            <h2>Konektor logy (Bazar ↔ Depozitka)</h2>
            <div className="logs">
              {connectorLogs.length === 0 && <p className="hint">Zatím bez volání API.</p>}
              {connectorLogs.map((line, i) => (
                <pre key={`${i}-${line.slice(0, 30)}`}>{line}</pre>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

export default App
