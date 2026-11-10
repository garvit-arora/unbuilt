import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight, Bell, Check, Compass, Lightbulb, Sparkles, Users, Wallet } from "lucide-react";
import { DashboardIntent } from "@/components/demand/dashboard-intent";
import { DemoChip, FallbackAiChip, SandboxBadge } from "@/components/layout/labels";
import { formatDate, formatNumber, formatRelativeTime } from "@/lib/format";
import { CLUSTER_STATUS_LABELS, label, PAYMENT_STATUS_LABELS } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import type { SessionUser } from "@/server/auth/guards";
import type { DashboardData } from "@/server/services/dashboard.service";
import type { PaymentListItem } from "@/server/services/analytics.service";

function IdeaArt({ kind }: { kind: "wish" | "discover" | "build" }) {
  return <div className={`idea-art art-${kind}`} aria-hidden>
    {kind === "wish" ? <><span className="art-orbit" /><Lightbulb size={88} strokeWidth={1.2} /><span className="art-star">✦</span></> : kind === "discover" ? <><span className="art-globe"><i /><i /><i /></span><span className="art-star">✦</span></> : <><span className="art-block block-one" /><span className="art-block block-two" /><span className="art-block block-three" /><span className="art-star">✦</span></>}
  </div>;
}

export function DashboardView({ user, data, purchases }: { user: SessionUser; data: DashboardData; purchases: PaymentListItem[] }) {
  const priced = data.clusters.filter(c => c.intent?.status === "active" && c.intent.level === "price_qualified").length;
  const builder = user.role !== "buyer";
  return (
    <div className="buyer-dashboard">
      <section className="dashboard-hero" aria-labelledby="welcome-title">
        <div className="hero-intro"><p>Hey, {user.displayName}! <span aria-hidden>✳</span></p><h2 id="welcome-title">Your ideas.<br />{" "}Our next<br />{" "}<span>possibilities.</span></h2><p className="hero-description">{data.clusters.length ? `You're part of ${data.clusters.length} demand ${data.clusters.length === 1 ? "cluster" : "clusters"}. Let's turn shared wishes into something real.` : "The things you wish existed could be what others are waiting for, too."}</p><Link href="/wish" className="dashboard-button dark-button">Make a wish <ArrowUpRight size={17} aria-hidden /></Link></div>
        <div className="hero-actions">
          <Link href="/wish" className="idea-card wish-card"><span className="idea-card-top">01 <ArrowUpRight size={18} /></span><h3>Start with<br />a wish</h3><IdeaArt kind="wish" /><span className="idea-card-caption">Tell us what&apos;s missing</span></Link>
          <Link href="/discover" className="idea-card discover-card"><span className="idea-card-top">02 <ArrowUpRight size={18} /></span><h3>Find your<br />people</h3><IdeaArt kind="discover" /><span className="idea-card-caption">Explore shared demand</span></Link>
          <Link href={builder ? "/builder" : "#clusters"} className="idea-card build-card"><span className="idea-card-top">03 <ArrowUpRight size={18} /></span><h3>{builder ? <>Build what<br />comes next</> : <>Watch ideas<br />take shape</>}</h3><IdeaArt kind="build" /><span className="idea-card-caption">{builder ? "Open your workspace" : "Follow your clusters"}</span></Link>
        </div>
      </section>
      <div className="dashboard-stats" aria-label="Your activity summary">
        {[{ icon: Lightbulb, value: data.wishes.length, title: "Wishes shared", href: "#wishes" }, { icon: Users, value: data.clusters.length, title: "Clusters joined", href: "#clusters" }, { icon: Check, value: priced, title: "Prices stated", href: "#clusters" }].map(({ icon: Icon, value, title, href }) => <Link href={href} key={title}><span className="stat-icon"><Icon size={18} aria-hidden /></span><strong>{formatNumber(value)}</strong><span>{title}</span><ArrowDown size={14} className="stat-arrow" aria-hidden /></Link>)}
      </div>
      <div className="dashboard-columns">
        <div className="dashboard-primary">
          <section id="clusters" className="dashboard-section" aria-labelledby="clusters-title">
            <div className="section-heading"><div><p className="eyebrow">SHARED AMBITION</p><h2 id="clusters-title">My demand clusters <span className="count-pill">{data.clusters.length}</span></h2></div><Link href="/discover" className="quiet-link">Explore more <ArrowUpRight size={15} aria-hidden /></Link></div>
            <p className="section-description">Follow the ideas you believe in. Set a price to help builders understand what matters.</p>
            {!data.clusters.length ? <div className="dashboard-empty"><Compass size={30} strokeWidth={1.3} aria-hidden /><h3>Find an idea you believe in</h3><p>Join people who want the same thing. Your interest helps builders decide what to build.</p><Link href="/discover" className="dashboard-text-link">Discover demand <ArrowRight size={16} aria-hidden /></Link></div> : <ul className="cluster-timeline" data-testid="my-clusters">{data.clusters.map((c, index) => <li key={c.id}><div className="timeline-marker"><span>{String(index + 1).padStart(2, "0")}</span></div><div className="cluster-detail"><div className="cluster-title-row"><Link href={`/demand/${c.slug}`}><h3>{c.title}</h3></Link><span className="status-tag">{label(CLUSTER_STATUS_LABELS, c.status)}</span>{c.includesDemo ? <DemoChip /> : null}</div><p>{formatNumber(c.interested)} interested <span aria-hidden>·</span> {formatNumber(c.priceQualified)} with a price in mind</p><DashboardIntent clusterId={c.id} intent={c.intent} /><span className="cluster-joined">Joined {formatDate(c.joinedAt)}</span></div><Link className="cluster-open" href={`/demand/${c.slug}`} aria-label={`View ${c.title}`}><ArrowUpRight size={19} /></Link></li>)}</ul>}
          </section>
          <section id="wishes" className="dashboard-section" aria-labelledby="wishes-title"><div className="section-heading"><div><p className="eyebrow">WHERE IT ALL STARTS</p><h2 id="wishes-title">My wishes <span className="count-pill">{data.wishes.length}</span></h2></div><Link href="/wish" className="quiet-link">New wish <span aria-hidden>+</span></Link></div>{!data.wishes.length ? <div className="wish-empty"><Lightbulb size={23} aria-hidden /><div><h3>What do you wish existed?</h3><p>A small frustration can be the start of something useful.</p><Link href="/wish" className="dashboard-text-link">Share your first wish <ArrowRight size={15} aria-hidden /></Link></div></div> : <ul className="dashboard-wishes">{data.wishes.map(w => <li key={w.id}><div className="wish-meta"><span>{formatDate(w.createdAt)}</span>{w.provider === "fallback" ? <FallbackAiChip /> : null}</div><h3>{w.title}</h3><blockquote>{w.rawText}</blockquote>{w.cluster ? <Link href={`/demand/${w.cluster.slug}`} className="dashboard-text-link">{w.cluster.title} <ArrowUpRight size={15} aria-hidden /></Link> : <span className="text-sm text-muted-text">Not linked to a demand cluster yet</span>}</li>)}</ul>}</section>
        </div>
        <aside className="dashboard-secondary">
          <section id="notifications" className="dashboard-section" aria-labelledby="notifications-title"><div className="section-heading"><h2 id="notifications-title">Your updates</h2><Bell size={18} className="text-muted-text" aria-hidden /></div><p className="section-description">The latest from your corner of UNBUILT.</p>{!data.notifications.length ? <div className="updates-empty"><span className="updates-empty-icon"><Bell size={24} strokeWidth={1.3} aria-hidden /></span><h3>You&apos;re all caught up</h3><p>New matches, proposals, and launches will appear here.</p></div> : <ul className="dashboard-updates">{data.notifications.map(n => <li key={n.id} className={n.read ? "" : "unread-update"}><span className="update-time">{formatRelativeTime(n.createdAt)}{!n.read ? <span className="unread-dot" aria-label="Unread" /> : null}</span><h3>{n.href ? <Link href={n.href}>{n.title}<ArrowUpRight size={14} aria-hidden /></Link> : n.title}</h3>{n.body ? <p>{n.body}</p> : null}</li>)}</ul>}</section>
          <section className="dashboard-section" aria-labelledby="purchases-title"><div className="section-heading"><h2 id="purchases-title">My purchases</h2><Wallet size={18} className="text-muted-text" aria-hidden /></div><SandboxBadge />{!purchases.length ? <div className="purchase-empty" data-testid="purchases-empty"><p>No purchases yet.</p><span>When a product is ready, you can buy it from its product page.</span></div> : <ul className="dashboard-purchases" data-testid="my-purchases">{purchases.map(p => <li key={p.id}><Link href={`/products/${p.offerId}`}>{p.offerTitle}<ArrowUpRight size={14} aria-hidden /></Link><div><strong>{formatCents(p.amountCents, p.currency)}</strong><span>{label(PAYMENT_STATUS_LABELS, p.status)}</span></div><time>{formatDate(p.completedAt ?? p.createdAt)}</time></li>)}</ul>}<Link href="/payments" className="dashboard-text-link">All payments & receipts <ArrowRight size={15} aria-hidden /></Link></section>
          <div className="dashboard-note"><Sparkles size={22} strokeWidth={1.4} aria-hidden /><p>You don’t have to build it.<br /><strong>Just wish it existed.</strong></p><Link href="/wish" aria-label="Make a wish"><ArrowUpRight size={20} /></Link></div>
        </aside>
      </div>
    </div>
  );
}
