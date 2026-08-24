import type { Request, Response } from "express";
import { liveAudioStreamService } from "../services/liveAudioStreamService.js";

export async function getLiveAudio(request: Request, response: Response): Promise<void> {
  await liveAudioStreamService.subscribe(String(request.params.token ?? ""), response);
}

export function headLiveAudio(request: Request, response: Response): void {
  liveAudioStreamService.probe(String(request.params.token ?? ""), response);
}
