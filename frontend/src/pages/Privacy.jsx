import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Ban, Bell, ChevronDown, FileText, Lock, ShieldCheck, Smartphone, Trash2, User } from 'lucide-react'
import api, { parseError } from '../api'
import { clearAuth, useAuth } from '../auth'
import { ErrorBox, Lumi } from '../components/ui'
import { TRASH_DAYS } from '../utils'

/*
 * Privacy notice (PDPA 2010 s7: what, why, source, who else, required or not, access, contact,
 * in English AND Malay) plus house rules and "delete my account".
 * Layered: three key facts first, details as questions you tap open.
 */
const T = {
  en: {
    title: 'Privacy and rules',
    updated: 'Last updated 25 Nov 2026',
    glance: ['We never sell your data or show ads.', 'Phone numbers only show to signed-in students.', 'Delete your account and posts any time.'],
    privacy: 'Your privacy',
    data: [
      ['Account', 'Username, display name, password (stored scrambled)', 'Needed to post'],
      ['Your posts', 'Text, photo, pickup places, contact details', 'You choose what to add'],
      ['Notifications', 'Browser notification address, categories you follow. Not linked to your account.', 'Optional'],
      ['On this phone', 'Your login, whether you’ve seen the guide', 'Stays on your phone'],
    ],
    source: 'All of it comes from you.',
    faq: [
      ['What do you collect about me?', null],
      ['Why do you need it?', 'To show your posts with your name, let only you edit them, let buyers contact you, and send the notifications you asked for. Nothing else.'],
      ['Who else sees it?', 'Anyone can see your posts. Phone numbers and emails only show to signed-in students. Our service providers handle data for us: Vercel and our database host (hosting), DeepSeek (AI, servers in China) only when you tap “Fill in for me” or post a lost or found item (the text of lost and found posts, never contact details, is sent to find matches), and Google, Apple or Mozilla to deliver notifications.'],
      ['Do you sell my data?', 'No. No ads, no selling, no sharing for marketing.'],
      ['How long do you keep it?', `Posts stay until you delete them. Expired posts are hidden but kept, so you can edit and repost them. Deleted posts stay in your Trash for ${TRASH_DAYS} days, then are erased. Deleting your account erases everything at once.`],
      ['Can I see, fix or delete it?', 'Yes. Edit or delete any post from My posts. Delete your account at the bottom of this page to erase everything at once.'],
      ['How do I contact you?', 'Message the LumaCam team (Trinovate, Swinburne Sarawak).'],
    ],
    login: 'Log in', toDelete: 'to delete your account.',
    rules: 'House rules',
    banned: 'Not allowed',
    bannedList: ['Alcohol', 'Tobacco and vapes', 'Medicine', 'Weapons', 'Fake or stolen goods', 'Doing others’ assignments', 'Other people’s personal details'],
    safe: 'Selling safely',
    safeList: [
      'You’re responsible for what you post, and the photos must be yours.',
      'Selling food? You handle your own food safety requirements, like food handler training and typhoid vaccination.',
      'We don’t take payments. Meet in a public place on campus and check the item before you pay.',
      'We remove posts and accounts that break these rules.',
    ],
    del: {
      title: 'Delete my account', text: 'Erases your account and all your posts, including the ones in your Trash. This can’t be undone.',
      password: 'Your password', button: 'Delete my account', busy: 'Deleting...',
      confirm: 'Delete your account and all your posts for good? This can’t be undone.',
    },
  },
  ms: {
    title: 'Privasi dan peraturan',
    updated: 'Kemas kini terakhir 25 Nov 2026',
    glance: ['Kami tidak menjual data anda atau memaparkan iklan.', 'Nombor telefon hanya ditunjukkan kepada pelajar yang log masuk.', 'Padam akaun dan siaran anda pada bila-bila masa.'],
    privacy: 'Privasi anda',
    data: [
      ['Akaun', 'Nama pengguna, nama paparan, kata laluan (disimpan secara tersulit)', 'Wajib untuk membuat siaran'],
      ['Siaran anda', 'Teks, gambar, tempat ambil barang, butiran hubungan', 'Anda pilih apa yang dimasukkan'],
      ['Pemberitahuan', 'Alamat pemberitahuan pelayar dan kategori yang anda ikuti. Tidak dikaitkan dengan akaun anda.', 'Pilihan'],
      ['Pada telefon ini', 'Log masuk anda dan sama ada anda sudah melihat panduan', 'Kekal pada telefon anda'],
    ],
    source: 'Semua data ini datang daripada anda sendiri.',
    faq: [
      ['Apakah data yang dikumpul tentang saya?', null],
      ['Mengapa data ini diperlukan?', 'Untuk memaparkan siaran anda bersama nama anda, memastikan hanya anda boleh menyuntingnya, membolehkan pembeli menghubungi anda, dan menghantar pemberitahuan yang anda minta. Itu sahaja.'],
      ['Siapa lagi yang boleh melihatnya?', 'Sesiapa sahaja boleh melihat siaran anda. Nombor telefon dan e-mel hanya ditunjukkan kepada pelajar yang log masuk. Penyedia perkhidmatan kami mengendalikan data bagi pihak kami: Vercel dan penyedia pangkalan data kami (pengehosan), DeepSeek (AI, pelayan di China) hanya apabila anda menekan “Fill in for me” atau menyiarkan barang hilang atau dijumpai (teks siaran hilang dan dijumpai, bukan butiran hubungan, dihantar untuk mencari padanan), serta Google, Apple atau Mozilla untuk menghantar pemberitahuan.'],
      ['Adakah data saya dijual?', 'Tidak. Tiada iklan, tiada penjualan dan tiada perkongsian untuk pemasaran.'],
      ['Berapa lama data disimpan?', `Siaran kekal sehingga anda memadamnya. Siaran yang tamat tempoh disembunyikan tetapi disimpan supaya anda boleh menyunting dan menyiarkannya semula. Siaran yang dipadam kekal dalam Trash selama ${TRASH_DAYS} hari, kemudian dihapuskan. Memadam akaun menghapuskan semuanya serta-merta.`],
      ['Bolehkah saya melihat, membetulkan atau memadam data saya?', 'Boleh. Sunting atau padam mana-mana siaran di My posts. Padam akaun anda di bahagian bawah halaman ini untuk menghapuskan semuanya sekali gus.'],
      ['Bagaimana saya boleh menghubungi anda?', 'Hubungi pasukan LumaCam (Trinovate, Swinburne Sarawak).'],
    ],
    login: 'Log masuk', toDelete: 'untuk memadam akaun anda.',
    rules: 'Peraturan',
    banned: 'Tidak dibenarkan',
    bannedList: ['Alkohol', 'Rokok dan vape', 'Ubat-ubatan', 'Senjata', 'Barang palsu atau curi', 'Membuat tugasan orang lain', 'Butiran peribadi orang lain'],
    safe: 'Berjual dengan selamat',
    safeList: [
      'Anda bertanggungjawab atas apa yang anda siarkan, dan gambar mestilah milik anda.',
      'Menjual makanan? Anda bertanggungjawab atas keperluan keselamatan makanan sendiri, seperti latihan pengendali makanan dan suntikan tifoid.',
      'Kami tidak mengendalikan bayaran. Berjumpa di tempat awam dalam kampus dan periksa barang sebelum membayar.',
      'Kami akan membuang siaran dan akaun yang melanggar peraturan ini.',
    ],
    del: {
      title: 'Padam akaun saya', text: 'Menghapuskan akaun anda dan semua siaran anda, termasuk yang ada dalam Trash. Tindakan ini tidak boleh dibatalkan.',
      password: 'Kata laluan anda', button: 'Padam akaun saya', busy: 'Memadam...',
      confirm: 'Padam akaun dan semua siaran anda secara kekal? Tindakan ini tidak boleh dibatalkan.',
    },
  },
}
const DATA_ICONS = [User, FileText, Bell, Smartphone]
const GLANCE_ICONS = [ShieldCheck, Lock, Trash2]

export default function Privacy() {
  const { loggedIn } = useAuth()
  const [lang, setLang] = useState('en')
  const t = T[lang]
  return (
    <div className="legal">
      <header className="legal-head">
        <Lumi mood="wink" size={72} />
        <div>
          <h1>{t.title}</h1>
          <p className="muted small">{t.updated}</p>
        </div>
        <div className="lang-switch" role="group" aria-label="Language">
          {[['en', 'EN'], ['ms', 'BM']].map(([code, label]) => (
            <button key={code} type="button" aria-pressed={lang === code} onClick={() => setLang(code)}>{label}</button>
          ))}
        </div>
      </header>

      <ul className="card legal-glance">
        {t.glance.map((line, i) => {
          const Icon = GLANCE_ICONS[i]
          return <li key={line}><Icon size={18} /> {line}</li>
        })}
      </ul>

      <h2>{t.privacy}</h2>
      <div className="card legal-faq">
        {t.faq.map(([q, a], i) => (
          <details key={q} open={i === 0}>
            <summary>{q}<ChevronDown size={18} /></summary>
            {a ? <p>{a}</p> : (
              <>
                <ul className="data-list">
                  {t.data.map(([name, what, need], j) => {
                    const Icon = DATA_ICONS[j]
                    return (
                      <li key={name}>
                        <Icon size={18} />
                        <div><strong>{name}</strong><span className="muted small">{what}</span></div>
                        <span className="data-need">{need}</span>
                      </li>
                    )
                  })}
                </ul>
                <p className="muted small">{t.source}</p>
              </>
            )}
          </details>
        ))}
      </div>

      <h2>{t.rules}</h2>
      <div className="card legal-rules">
        <h3>{t.banned}</h3>
        <ul className="banned">
          {t.bannedList.map((item) => <li key={item}><Ban size={14} /> {item}</li>)}
        </ul>
        <h3>{t.safe}</h3>
        <ul className="safe">{t.safeList.map((s) => <li key={s}>{s}</li>)}</ul>
      </div>

      {loggedIn
        ? <DeleteAccount t={t.del} />
        : <p className="muted small center-text"><Link to="/login?next=/privacy">{t.login}</Link> {t.toDelete}</p>}
    </div>
  )
}

function DeleteAccount({ t }) {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const erase = async (e) => {
    e.preventDefault()
    if (!window.confirm(t.confirm)) return
    setBusy(true); setError('')
    try {
      await api.delete('/auth/me/', { data: { password } })
      clearAuth()
      navigate('/', { replace: true })
    } catch (err) {
      setError(parseError(err).message)
    } finally { setBusy(false) }
  }

  return (
    <form className="card delete-account" onSubmit={erase}>
      <h2>{t.title}</h2>
      <p className="muted small">{t.text}</p>
      <ErrorBox message={error} />
      <label htmlFor="delete-password">{t.password}</label>
      <input id="delete-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      <button className="btn btn-danger" disabled={busy || !password}>
        <Trash2 size={16} /> {busy ? t.busy : t.button}
      </button>
    </form>
  )
}
