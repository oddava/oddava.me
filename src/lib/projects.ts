import { getCollection } from 'astro:content';

export interface Project {
    id: string;
    title: string;
    description: string;
    tech: string[];
    url?: string;
    repo?: string;
    featured: boolean;
}

export async function getAllProjects(): Promise<Project[]> {
    const entries = await getCollection('projects');
    return entries.map((entry) => ({
        id: entry.id,
        title: entry.data.title,
        description: entry.data.description,
        tech: entry.data.tech ?? [],
        url: entry.data.url,
        repo: entry.data.repo,
        featured: entry.data.featured ?? false,
    }));
}

export async function getFeaturedProjects(): Promise<Project[]> {
    const all = await getAllProjects();
    return all.filter((p) => p.featured);
}
