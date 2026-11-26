/**
 * Heure corrigée : les téléphones ont souvent une horloge fausse. On mesure l'écart avec
 * le serveur à chaque synchronisation et on l'applique aux heures d'écriture.
 */
export class Clock {
  constructor(public offsetMs = 0) {}

  now(): string {
    return new Date(Date.now() + this.offsetMs).toISOString();
  }

  /** Met à jour l'écart à partir de l'heure renvoyée par le serveur. */
  observe(serverTime: string, sentAt: number, receivedAt: number): void {
    const server = Date.parse(serverTime);
    if (Number.isNaN(server)) return;
    this.offsetMs = Math.round(server - (sentAt + receivedAt) / 2);
  }
}
