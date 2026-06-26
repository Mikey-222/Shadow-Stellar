/**
 * Stellar Helper - Blockchain Logic with Stellar Wallets Kit
 * ⚠️ DO NOT MODIFY THIS FILE! ⚠️
 *
 * All SDK and wallet-kit imports are lazy so this module is SSR-safe.
 */

export class StellarHelper {
  private networkPassphrase: string;
  private horizonUrl: string;
  private networkEnum: string;
  private publicKey: string | null = null;
  private initialized = false;

  constructor(network: "testnet" | "mainnet" = "testnet") {
    this.horizonUrl =
      network === "testnet"
        ? "https://horizon-testnet.stellar.org"
        : "https://horizon.stellar.org";
    this.networkPassphrase =
      network === "testnet"
        ? "Test SDF Network ; September 2015"
        : "Public Global Stellar Network ; September 2015";
    this.networkEnum = network === "testnet" ? "TESTNET" : "PUBLIC";
  }

  private async getServer() {
    const mod = await import("@stellar/stellar-sdk");
    const s: any = (mod as any).default ?? mod;
    return new s.Horizon.Server(this.horizonUrl);
  }

  private async ensureInit(): Promise<void> {
    if (this.initialized) return;

    const [
      { StellarWalletsKit, Networks },
      { FreighterModule, FREIGHTER_ID },
      { AlbedoModule },
      { xBullModule },
      { RabetModule },
      { LobstrModule },
      { HanaModule },
    ] = await Promise.all([
      import("@creit.tech/stellar-wallets-kit"),
      import("@creit.tech/stellar-wallets-kit/modules/freighter"),
      import("@creit.tech/stellar-wallets-kit/modules/albedo"),
      import("@creit.tech/stellar-wallets-kit/modules/xbull"),
      import("@creit.tech/stellar-wallets-kit/modules/rabet"),
      import("@creit.tech/stellar-wallets-kit/modules/lobstr"),
      import("@creit.tech/stellar-wallets-kit/modules/hana"),
    ]);

    const net = this.networkEnum === "TESTNET" ? Networks.TESTNET : Networks.PUBLIC;

    StellarWalletsKit.init({
      network: net,
      selectedWalletId: FREIGHTER_ID,
      modules: [
        new FreighterModule(),
        new AlbedoModule(),
        new xBullModule(),
        new RabetModule(),
        new LobstrModule(),
        new HanaModule(),
      ],
    });

    this.initialized = true;
  }

  isFreighterInstalled(): boolean {
    return true;
  }

  async connectWallet(): Promise<string> {
    await this.ensureInit();
    const { StellarWalletsKit } = await import("@creit.tech/stellar-wallets-kit");
    try {
      const { address } = await StellarWalletsKit.authModal();
      if (!address) throw new Error("No address returned from wallet");
      this.publicKey = address;
      return address;
    } catch (error: any) {
      throw new Error("Wallet connection failed: " + error.message);
    }
  }

  async getBalance(publicKey: string): Promise<{
    xlm: string;
    assets: Array<{ code: string; issuer: string; balance: string }>;
  }> {
    const server = await this.getServer();
    const account = await server.loadAccount(publicKey);
    const xlmBalance = account.balances.find((b: any) => b.asset_type === "native");
    const assets = account.balances
      .filter((b: any) => b.asset_type !== "native")
      .map((b: any) => ({
        code: b.asset_code,
        issuer: b.asset_issuer,
        balance: b.balance,
      }));

    return {
      xlm: xlmBalance && "balance" in xlmBalance ? xlmBalance.balance : "0",
      assets,
    };
  }

  async signTransaction(txXdr: string): Promise<string> {
    await this.ensureInit();
    const { StellarWalletsKit } = await import("@creit.tech/stellar-wallets-kit");
    const { signedTxXdr } = await StellarWalletsKit.signTransaction(txXdr, {
      networkPassphrase: this.networkPassphrase,
    });
    return signedTxXdr;
  }

  async sendPayment(params: {
    from: string;
    to: string;
    amount: string;
    memo?: string;
  }): Promise<{ hash: string; success: boolean }> {
    const mod = await import("@stellar/stellar-sdk");
    const s: any = (mod as any).default ?? mod;
    const server = await this.getServer();
    const account = await server.loadAccount(params.from);

    const builder = new s.TransactionBuilder(account, {
      fee: s.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    }).addOperation(
      s.Operation.payment({
        destination: params.to,
        asset: s.Asset.native(),
        amount: params.amount,
      }),
    );

    if (params.memo) builder.addMemo(s.Memo.text(params.memo));

    const tx = builder.setTimeout(180).build();
    const signedXdr = await this.signTransaction(tx.toXDR());
    const signed = s.TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase);
    const result = await server.submitTransaction(signed);

    return { hash: result.hash, success: result.successful };
  }

  async getRecentTransactions(
    publicKey: string,
    limit = 10,
  ): Promise<
    Array<{
      id: string;
      type: string;
      amount?: string;
      asset?: string;
      from?: string;
      to?: string;
      createdAt: string;
      hash: string;
    }>
  > {
    const server = await this.getServer();
    const payments = await server
      .payments()
      .forAccount(publicKey)
      .order("desc")
      .limit(limit)
      .call();

    return payments.records.map((p: any) => ({
      id: p.id,
      type: p.type,
      amount: p.amount,
      asset: p.asset_type === "native" ? "XLM" : p.asset_code,
      from: p.from,
      to: p.to,
      createdAt: p.created_at,
      hash: p.transaction_hash,
    }));
  }

  getExplorerLink(hash: string, type: "tx" | "account" = "tx"): string {
    const net = this.networkPassphrase.includes("Test") ? "testnet" : "public";
    return `https://stellar.expert/explorer/${net}/${type}/${hash}`;
  }

  formatAddress(address: string, startChars = 4, endChars = 4): string {
    if (address.length <= startChars + endChars) return address;
    return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
  }

  disconnect() {
    this.publicKey = null;
    import("@creit.tech/stellar-wallets-kit")
      .then(({ StellarWalletsKit }) => StellarWalletsKit.disconnect())
      .catch(() => {});
    return true;
  }
}

export const stellar = new StellarHelper("testnet");
