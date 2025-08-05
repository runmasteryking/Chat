export default async (req, res) => {
  const { message } = JSON.parse(req.body);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: message }],
      temperature: 0.7
    })
  });

  const data = await response.json();

  res.status(200).json({
    reply: data.choices?.[0]?.message?.content || "Sorry, I couldn't think of a reply."
  });
};
