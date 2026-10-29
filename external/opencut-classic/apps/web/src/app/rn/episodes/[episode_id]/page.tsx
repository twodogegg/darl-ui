"use client";

import { useParams } from "next/navigation";
import Editor from "@/app/editor/[project_id]/page";

export default function EpisodeEditor() {
	const params = useParams();
	const episodeId = String(params.episode_id);
	if (!/^[\w:.-]+$/.test(episodeId)) return null;
	return <Editor episodeId={episodeId} />;
}
