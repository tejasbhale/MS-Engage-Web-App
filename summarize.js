//Post-call summarization pipeline: a two-step LangChain chain over Gemini
//Flash. Step 1 writes a 3–5 sentence summary; step 2 extracts action items as
//structured JSON via LangChain's StructuredOutputParser (typed, not regexed).
//Exposed as a single summarizeAndExtract(transcript) boundary so the caller
//never sees LangChain details and the implementation can be swapped.

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { PromptTemplate } = require("@langchain/core/prompts");
const {
  StringOutputParser,
  StructuredOutputParser,
} = require("@langchain/core/output_parsers");
const { z } = require("zod");

const actionItemsSchema = z.object({
  actionItems: z
    .array(
      z.object({
        task: z.string().describe("The action item, phrased as a short imperative task"),
        owner: z
          .string()
          .nullable()
          .describe("Person responsible, exactly as named in the transcript, or null if not mentioned"),
        dueDate: z
          .string()
          .nullable()
          .describe(
            "Due date/time if mentioned, as an ISO 8601 local datetime (e.g. 2026-07-10T17:00) resolved relative to the meeting date; null if none. Default to 17:00 when only a day is mentioned."
          ),
      })
    )
    .describe("Every concrete follow-up task agreed to in the meeting"),
});

const SUMMARY_PROMPT = PromptTemplate.fromTemplate(
  `You are a precise meeting assistant. Summarize the following meeting transcript
in 3-5 sentences. Focus on decisions made, topics discussed, and outcomes.
Write plain prose with no preamble, headings, or bullet points.

Transcript:
{transcript}`
);

const ACTION_ITEMS_PROMPT = PromptTemplate.fromTemplate(
  `Extract the action items from this meeting transcript. Only include concrete
tasks someone committed to or was asked to do. If there are none, return an
empty list. The meeting took place on {meetingDate} — resolve any relative
due dates ("tomorrow", "by Friday") against that date.

{format_instructions}

Transcript:
{transcript}`
);

const summarizeWithGemini = async (transcript) => {
  const model = new ChatGoogleGenerativeAI({
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    temperature: 0.2,
    apiKey: process.env.GOOGLE_API_KEY,
  });

  //Step 1 — concise prose summary.
  const summaryChain = SUMMARY_PROMPT.pipe(model).pipe(new StringOutputParser());
  const summary = (await summaryChain.invoke({ transcript })).trim();

  //Step 2 — structured action items.
  const parser = StructuredOutputParser.fromZodSchema(actionItemsSchema);
  const itemsChain = ACTION_ITEMS_PROMPT.pipe(model).pipe(parser);
  let actionItems = [];
  try {
    const parsed = await itemsChain.invoke({
      transcript,
      meetingDate: new Date().toDateString(),
      format_instructions: parser.getFormatInstructions(),
    });
    actionItems = parsed.actionItems;
  } catch (err) {
    //A malformed model response shouldn't sink the whole summary.
    console.error("Action item extraction failed:", err.message);
  }

  return { summary, actionItems, engine: "gemini" };
};

//Keyless fallback: keeps the post-call flow working before GOOGLE_API_KEY is
//configured. First sentences as a crude summary; commitment-sounding lines as
//action items, owned by their speaker.
const fallbackSummarize = (transcript) => {
  const lines = transcript
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const prose = lines.map((l) => l.replace(/^[^:]{1,40}:\s*/, "")).join(" ");
  const sentences = prose.match(/[^.!?]+[.!?]+/g) || [prose];
  const summary = sentences.slice(0, 4).join(" ").trim();

  const commitment = /\b(i(?:'|’)?ll|will|need to|going to|let(?:'|’)?s|send|share|review|schedule|follow up)\b/i;
  const actionItems = lines
    .filter((l) => commitment.test(l))
    .slice(0, 6)
    .map((l) => {
      const m = l.match(/^([^:]{1,40}):\s*(.+)$/);
      return {
        task: (m ? m[2] : l).trim(),
        owner: m ? m[1].trim() : null,
        dueDate: null,
      };
    });

  return { summary, actionItems, engine: "fallback" };
};

const summarizeAndExtract = async (transcript) => {
  if (!process.env.GOOGLE_API_KEY) {
    return fallbackSummarize(transcript);
  }
  try {
    return await summarizeWithGemini(transcript);
  } catch (err) {
    console.error("Gemini summarization failed, using fallback:", err.message);
    return { ...fallbackSummarize(transcript), degraded: err.message };
  }
};

module.exports = { summarizeAndExtract };
