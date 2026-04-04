import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import './App.css'
import { isMissingConfig, supabase } from './lib/supabase'

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
  priceCzk: number
  sellerName: string
  sellerEmail: string
  paymentMethods: PaymentMethod[]
  isActive: boolean
}

interface MarketplaceOrder {
  id: string
  externalOrderId: string
  listingId: string
  listingTitle: string
  buyerName: string
  buyerEmail: string
  sellerName: string
  sellerEmail: string
  amountCzk: number
  paymentMethod: PaymentMethod
  localStatus: string
  escrowStatus: EscrowStatus
  escrowTransactionCode: string
  createdAt: string
  updatedAt: string
}

interface CreateTxResponse {
  transaction_code?: string
}

const MARKETPLACE_CODE = 'depozitka-test-bazar'

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
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

function mapEscrowToMarketplaceStatus(depStatus: EscrowStatus): string {
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

function formatPrice(value: number): string {
  return `${new Intl.NumberFormat('cs-CZ').format(value)} Kč`
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('cs-CZ')
}

function generateOrderId(): string {
  return `TB-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`
}

function parsePaymentMethods(value: unknown): PaymentMethod[] {
  if (!Array.isArray(value)) return ['Escrow']

  const allowed: PaymentMethod[] = ['Escrow', 'Převod', 'Dobírka']
  const normalized = value.filter((item): item is PaymentMethod =>
    typeof item === 'string' ? (allowed as string[]).includes(item) : false,
  )

  return normalized.length ? normalized : ['Escrow']
}

function App() {
  const [sessionEmail, setSessionEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isAuthed, setIsAuthed] = useState(false)
  const [busy, setBusy] = useState(false)

  const [listings, setListings] = useState<Listing[]>([])
  const [orders, setOrders] = useState<MarketplaceOrder[]>([])
  const [selectedListingId, setSelectedListingId] = useState<string>('')

  const [buyerName, setBuyerName] = useState('Testující kupující')
  const [buyerEmail, setBuyerEmail] = useState('buyer@test.cz')
  const [marketplaceApiKey, setMarketplaceApiKey] = useState('')

  const [connectorLogs, setConnectorLogs] = useState<string[]>([])

  const escrowListings = useMemo(
    () => listings.filter((item) => item.isActive && item.paymentMethods.includes('Escrow')),
    [listings],
  )

  const selectedListing = useMemo(
    () => escrowListings.find((item) => item.id === selectedListingId),
    [escrowListings, selectedListingId],
  )

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

  function addLog(message: string): void {
    const ts = new Date().toLocaleString('cs-CZ')
    setConnectorLogs((prev) => [`[${ts}] ${message}`, ...prev].slice(0, 200))
  }

  const loadListings = useCallback(async () => {
    const { data, error } = await supabase
      .from('tb_listings')
      .select('id, title, price_czk, seller_name, seller_email, payment_methods, is_active')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      addLog(`❌ Načtení tb_listings selhalo: ${error.message}`)
      return
    }

    const mapped: Listing[] = (data || []).map((row) => ({
      id: String(row.id),
      title: String(row.title || ''),
      priceCzk: Number(row.price_czk || 0),
      sellerName: String(row.seller_name || ''),
      sellerEmail: String(row.seller_email || ''),
      paymentMethods: parsePaymentMethods(row.payment_methods),
      isActive: Boolean(row.is_active),
    }))

    setListings(mapped)
    if (!selectedListingId && mapped.length > 0) {
      setSelectedListingId(mapped[0].id)
    }

    addLog(`✅ Načteno ${mapped.length} inzerátů z tb_listings`)
  }, [selectedListingId])

  const loadOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from('tb_orders')
      .select(
        'id, external_order_id, listing_id, listing_title, buyer_name, buyer_email, seller_name, seller_email, amount_czk, payment_method, local_status, escrow_status, escrow_transaction_code, created_at, updated_at',
      )
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) {
      addLog(`❌ Načtení tb_orders selhalo: ${error.message}`)
      return
    }

    const mapped: MarketplaceOrder[] = (data || []).map((row) => ({
      id: String(row.id),
      externalOrderId: String(row.external_order_id || ''),
      listingId: String(row.listing_id || ''),
      listingTitle: String(row.listing_title || ''),
      buyerName: String(row.buyer_name || ''),
      buyerEmail: String(row.buyer_email || ''),
      sellerName: String(row.seller_name || ''),
      sellerEmail: String(row.seller_email || ''),
      amountCzk: Number(row.amount_czk || 0),
      paymentMethod: (String(row.payment_method || 'Escrow') as PaymentMethod),
      localStatus: String(row.local_status || 'Neznámý stav'),
      escrowStatus: String(row.escrow_status || 'created') as EscrowStatus,
      escrowTransactionCode: String(row.escrow_transaction_code || ''),
      createdAt: String(row.created_at || ''),
      updatedAt: String(row.updated_at || ''),
    }))

    setOrders(mapped)
    addLog(`✅ Načteno ${mapped.length} objednávek z tb_orders`)
  }, [])

  useEffect(() => {
    if (!isAuthed) return

    void loadListings()
    void loadOrders()
  }, [isAuthed, loadListings, loadOrders])

  useEffect(() => {
    if (!isAuthed) return

    const channel = supabase
      .channel('tb-orders-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tb_orders',
        },
        () => {
          void loadOrders()
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [isAuthed, loadOrders])

  async function signIn(): Promise<void> {
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
      return
    }

    addLog('✅ Přihlášení OK')
  }

  async function signOut(): Promise<void> {
    await supabase.auth.signOut()
    setOrders([])
    setConnectorLogs([])
  }

  async function createOrderWithEscrow(): Promise<void> {
    if (!selectedListing) {
      alert('Vyber inzerát')
      return
    }
    if (!buyerName.trim() || !buyerEmail.trim()) {
      alert('Vyplň jméno a email kupujícího')
      return
    }
    if (!marketplaceApiKey.trim()) {
      alert('Vyplň Marketplace API klíč')
      return
    }

    const externalOrderId = generateOrderId()
    const requestId = generateRequestId()

    setBusy(true)
    addLog(`→ Vytvářím escrow transakci (${externalOrderId}) přes API kontrakt`)

    const txRes = await supabase.rpc('dpt_create_transaction_safe', {
      p_marketplace_code: MARKETPLACE_CODE,
      p_api_key: marketplaceApiKey.trim(),
      p_request_id: requestId,
      p_external_order_id: externalOrderId,
      p_listing_id: selectedListing.id,
      p_listing_title: selectedListing.title,
      p_buyer_name: buyerName.trim(),
      p_buyer_email: buyerEmail.trim(),
      p_seller_name: selectedListing.sellerName,
      p_seller_email: selectedListing.sellerEmail,
      p_amount_czk: selectedListing.priceCzk,
      p_payment_method: 'escrow',
      p_metadata: {
        source: MARKETPLACE_CODE,
        connector: 'tb-client',
      },
    })

    if (txRes.error) {
      setBusy(false)
      addLog(`❌ dpt_create_transaction_safe selhalo: ${txRes.error.message}`)
      alert(`Vytvoření escrow transakce selhalo: ${txRes.error.message}`)
      return
    }

    const txData = txRes.data as CreateTxResponse | null
    const txCode = txData?.transaction_code

    if (!txCode) {
      setBusy(false)
      addLog('❌ dpt_create_transaction_safe vrátilo prázdnou odpověď')
      alert('Escrow transakce nemá transaction_code')
      return
    }

    addLog(`✅ Escrow vytvořeno: ${txCode} (request_id=${requestId})`)

    const insertRes = await supabase.from('tb_orders').insert({
      external_order_id: externalOrderId,
      listing_id: selectedListing.id,
      listing_title: selectedListing.title,
      buyer_name: buyerName.trim(),
      buyer_email: buyerEmail.trim().toLowerCase(),
      seller_name: selectedListing.sellerName,
      seller_email: selectedListing.sellerEmail.toLowerCase(),
      amount_czk: selectedListing.priceCzk,
      payment_method: 'Escrow',
      local_status: mapEscrowToMarketplaceStatus('created'),
      escrow_status: 'created',
      escrow_transaction_code: txCode,
      metadata: {
        marketplace_code: MARKETPLACE_CODE,
      },
    })

    setBusy(false)

    if (insertRes.error) {
      addLog(`❌ Uložení do tb_orders selhalo: ${insertRes.error.message}`)
      alert(`Objednávka vznikla v Depozitce, ale neuložila se do tb_orders: ${insertRes.error.message}`)
      return
    }

    addLog(`✅ Objednávka ${externalOrderId} uložená do tb_orders`)
    await loadOrders()
  }

  if (isMissingConfig) {
    return (
      <div className="app">
        <header className="topbar">
          <h1>🛒 Test Bazar</h1>
          <p>
            ⚠️ Chybí <code>VITE_SUPABASE_URL</code> nebo <code>VITE_SUPABASE_ANON_KEY</code>.
            Nastav je ve Vercelu a redeployni aplikaci.
          </p>
        </header>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>🛒 Depozitka Test Bazar</h1>
        <p>
          Varianta <strong>2</strong>: stejná Supabase jako Depozitka, ale vlastní tabulky
          <code> tb_*</code>. Escrow transakce se vytváří přes API kontrakt
          <code> dpt_create_transaction_safe</code> (marketplace API key + idempotency).
        </p>
      </header>

      {!isAuthed ? (
        <section className="panel">
          <h2>Přihlášení</h2>
          <p className="hint">Přihlas se účtem ze stejné Supabase instance.</p>
          <div className="formGrid">
            <label>
              Email
              <input type="email" value={sessionEmail} onChange={(e) => setSessionEmail(e.target.value)} />
            </label>
            <label>
              Heslo
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          </div>
          <button className="primary" disabled={busy} onClick={() => void signIn()}>
            {busy ? 'Přihlašuji…' : 'Přihlásit'}
          </button>
        </section>
      ) : (
        <>
          <section className="panel">
            <div className="adminTopActions">
              <strong>Přihlášen: {sessionEmail}</strong>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="ghost" onClick={() => void loadListings()} disabled={busy}>
                  Obnovit inzeráty
                </button>
                <button className="ghost" onClick={() => void loadOrders()} disabled={busy}>
                  Obnovit objednávky
                </button>
                <button className="ghost" onClick={() => void signOut()} disabled={busy}>
                  Odhlásit
                </button>
              </div>
            </div>
          </section>

          <div className="syncBanner">
            🔗 Marketplace data jsou v <code>tb_listings</code> + <code>tb_orders</code>. Escrow běží v
            Depozitce (<code>dpt_*</code>) a synchronizuje se přes transaction code.
          </div>

          <section className="panel">
            <h2>Nová objednávka</h2>

            <div className="formGrid">
              <label>
                Kupující (jméno)
                <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
              </label>
              <label>
                Kupující (email)
                <input type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} />
              </label>
              <label>
                Marketplace API key (Depozitka)
                <input
                  type="password"
                  value={marketplaceApiKey}
                  onChange={(e) => setMarketplaceApiKey(e.target.value)}
                  placeholder="dpt_live_..."
                />
              </label>
            </div>

            <div className="listings">
              {escrowListings.length === 0 && (
                <p className="hint">Žádné aktivní escrow inzeráty. Spusť SQL seed pro tb_listings.</p>
              )}

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
                    <span>{formatPrice(listing.priceCzk)}</span>
                    <span>{listing.paymentMethods.join(' · ')}</span>
                  </div>
                </article>
              ))}
            </div>

            <button className="primary" onClick={() => void createOrderWithEscrow()} disabled={busy || !selectedListing}>
              {busy ? 'Vytvářím…' : 'Vytvořit objednávku → Depozitka'}
            </button>
          </section>

          <section className="panel">
            <h2>Objednávky ({orders.length})</h2>
            {orders.length === 0 ? (
              <p className="hint">Zatím žádné objednávky.</p>
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
                      <th>Escrow stav</th>
                      <th>Aktualizováno</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order.id}>
                        <td>{order.externalOrderId}</td>
                        <td>{order.listingTitle}</td>
                        <td>
                          <code>{order.escrowTransactionCode}</code>
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
                        <td>{formatPrice(order.amountCzk)}</td>
                        <td>{order.localStatus}</td>
                        <td>
                          <span className={`status ${order.escrowStatus}`}>{statusLabel[order.escrowStatus]}</span>
                        </td>
                        <td>{formatDate(order.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <h2>Konektor logy</h2>
            <div className="logs">
              {connectorLogs.length === 0 && <p className="hint">Zatím bez logů.</p>}
              {connectorLogs.map((line, idx) => (
                <pre key={`${idx}-${line.slice(0, 20)}`}>{line}</pre>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

export default App
