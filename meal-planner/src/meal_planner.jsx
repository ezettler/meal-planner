import { useState, useEffect, useRef } from "react";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MEAL_TYPES = ["Breakfast", "Lunch", "Dinner"];
const STORES = ["Publix", "Aldi", "Trader Joe's", "Whole Foods", "Target", "Walmart", "Costco", "Other"];
const SALE_COLORS = { "Publix": "#006f3c", "Aldi": "#00519e", "Trader Joe's": "#c8001e", "Whole Foods": "#00674b", "Target": "#cc0000", "Walmart": "#0071ce", "Costco": "#005daa", "Other": "#666" };

const saleCache = {};

async function lookupSales(item) {
  if (!item || item.length < 3) return [];
  const key = item.toLowerCase().trim();
  if (saleCache[key] !== undefined && saleCache[key] !== "loading") return saleCache[key];
  saleCache[key] = "loading";
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        system: `You check current US grocery sale prices. Search for the current sale price for the given item at Publix, Target, Walmart, and Whole Foods. Return ONLY a valid JSON array (no markdown, no preamble) like:
[{"store":"Publix","price":"$1.99/lb","note":"BOGO this week"}]
Only include stores with a real current sale. Return [] if nothing found. Notes very brief.`,
        messages: [{ role: "user", content: `Current sale prices for: ${item}` }],
      }),
    });
    const data = await response.json();
    const textBlock = data.content?.find(b => b.type === "text");
    if (!textBlock) { saleCache[key] = []; return []; }
    const clean = textBlock.text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    saleCache[key] = Array.isArray(parsed) ? parsed : [];
  } catch { saleCache[key] = []; }
  return saleCache[key];
}

async function scrapeRecipeFromUrl(url) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      system: `You extract recipe information from URLs. Fetch the given URL and extract the recipe details. Return ONLY a valid JSON object (no markdown, no preamble) like:
{"name":"Recipe Name","tags":["quick","vegetarian"],"ingredients":["1 can black beans","2 tortillas","1 avocado"],"servings":"4","time":"30 min","description":"Brief one-sentence description"}
Include quantities in ingredients. Tags should include relevant ones like: quick, batch cook, family-friendly, healthy, weekend, brunch, meal prep. Always include "vegetarian" if it is vegetarian. If you cannot access the URL or find a recipe, return {"error":"Could not load recipe"}.`,
      messages: [{ role: "user", content: `Extract the recipe from this URL: ${url}` }],
    }),
  });
  const data = await response.json();
  const textBlock = data.content?.find(b => b.type === "text");
  if (!textBlock) throw new Error("No response");
  const clean = textBlock.text.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean);
  if (parsed.error) throw new Error(parsed.error);
  return parsed;
}

const SAMPLE_RECIPES = [
  { name: "Black Bean Tacos", tags: ["quick", "family-friendly", "vegetarian"], ingredients: ["black beans", "tortillas", "avocado", "salsa", "cheese", "lime"], url: null },
  { name: "Veggie Stir Fry", tags: ["quick", "healthy", "vegetarian"], ingredients: ["tofu", "broccoli", "bell pepper", "soy sauce", "garlic", "rice"], url: null },
  { name: "Lentil Soup", tags: ["batch cook", "hearty", "vegetarian"], ingredients: ["lentils", "carrots", "celery", "onion", "tomatoes", "vegetable broth"], url: null },
  { name: "Caprese Pasta", tags: ["quick", "summer", "vegetarian"], ingredients: ["pasta", "cherry tomatoes", "fresh mozzarella", "basil", "olive oil"], url: null },
  { name: "Veggie Quesadillas", tags: ["quick", "family-friendly", "vegetarian"], ingredients: ["tortillas", "black beans", "corn", "cheese", "bell pepper"], url: null },
  { name: "Chickpea Curry", tags: ["batch cook", "hearty", "vegetarian"], ingredients: ["chickpeas", "tomatoes", "coconut milk", "onion", "garlic", "curry powder", "rice"], url: null },
  { name: "Shakshuka", tags: ["brunch", "quick", "vegetarian"], ingredients: ["eggs", "crushed tomatoes", "bell pepper", "onion", "feta", "cumin"], url: null },
  { name: "Greek Bowls", tags: ["healthy", "meal prep", "vegetarian"], ingredients: ["quinoa", "cucumber", "cherry tomatoes", "olives", "feta", "hummus", "pita"], url: null },
  { name: "White Bean & Kale Soup", tags: ["batch cook", "healthy", "vegetarian"], ingredients: ["white beans", "kale", "tomatoes", "garlic", "vegetable broth", "parmesan"], url: null },
  { name: "Mushroom Tacos", tags: ["quick", "family-friendly", "vegetarian"], ingredients: ["portobello mushrooms", "tortillas", "avocado", "cabbage slaw", "lime", "cilantro"], url: null },
];

const DIETARY_OPTIONS = ["Vegetarian","Vegan","Gluten-free","Dairy-free","Nut-free","Halal","Kosher","Pescatarian","No restrictions"];

export default function MealPlanner() {
  const [setup, setSetup] = useState(true);
  const [household, setHousehold] = useState({ name: "", size: "2", dietary: [] });
  const [setupDraft, setSetupDraft] = useState({ name: "", size: "2", dietary: [] });
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState("plan");
  const [meals, setMeals] = useState(() => {
    const init = {};
    DAYS.forEach(d => { init[d] = { Breakfast: "", Lunch: "", Dinner: "" }; });
    return init;
  });
  const [saleItems, setSaleItems] = useState([]);
  const [newSale, setNewSale] = useState({ item: "", store: "Publix", price: "", note: "" });
  const [groceryList, setGroceryList] = useState([]);
  const [checkedItems, setCheckedItems] = useState({});
  const [recipes, setRecipes] = useState(SAMPLE_RECIPES);
  const [newRecipe, setNewRecipe] = useState({ name: "", tags: "", ingredients: "" });
  const [recipeFilter, setRecipeFilter] = useState("");
  const [showRecipePicker, setShowRecipePicker] = useState(null);
  const [urlInput, setUrlInput] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState("");
  const [expandedRecipe, setExpandedRecipe] = useState(null);

  const addFromUrl = async () => {
    if (!urlInput.trim()) return;
    setUrlLoading(true);
    setUrlError("");
    try {
      const recipe = await scrapeRecipeFromUrl(urlInput.trim());
      setRecipes(prev => [...prev, { ...recipe, url: urlInput.trim(), id: Date.now() }]);
      setUrlInput("");
    } catch (e) {
      setUrlError(e.message || "Could not load recipe from that URL. Try pasting the ingredients manually.");
    } finally {
      setUrlLoading(false);
    }
  };

  const addToGroceryList = async (recipe) => {
    // Strip quantities to get clean ingredient names for sale matching
    const cleanIngredient = (ing) => ing.replace(/^\d+[\d\/\s]*(cup|tbsp|tsp|oz|lb|g|kg|ml|l|can|clove|bunch|head|slice|piece|pkg|package|bag|box|jar|bottle|pinch|dash|handful|sprig|sheet|strip|large|medium|small|whole|fresh|dried|chopped|diced|minced|sliced|shredded|grated|cooked|raw|frozen|canned)?s?\s*/i, "").trim();

    const existing = new Set(groceryList.map(g => g.item));
    const newItems = recipe.ingredients
      .map(ing => ({ raw: ing, clean: cleanIngredient(ing) }))
      .filter(({ clean }) => clean && !existing.has(clean));

    if (newItems.length === 0) { setActiveTab("grocery"); return; }

    // Add items immediately, then enrich with sales in background
    const itemsToAdd = newItems.map(({ raw, clean }) => ({
      item: clean, raw, manual: false, saleMatch: null,
      saleLoading: true, id: `${clean}-${Date.now()}`,
      fromRecipe: recipe.name,
    }));
    setGroceryList(prev => [...prev, ...itemsToAdd]);
    setActiveTab("grocery");

    // Enrich with sale data in parallel
    await Promise.all(itemsToAdd.map(async (gi) => {
      const sales = await lookupSales(gi.item);
      const loggedMatch = saleItems.find(s =>
        gi.item.toLowerCase().includes(s.item.toLowerCase()) ||
        s.item.toLowerCase().includes(gi.item.toLowerCase())
      );
      const saleMatch = loggedMatch
        ? { store: loggedMatch.store, price: loggedMatch.price, item: gi.item }
        : sales.length > 0
        ? { store: sales[0].store, price: sales[0].price, note: sales[0].note, item: gi.item }
        : null;
      setGroceryList(prev => prev.map(g =>
        g.id === gi.id ? { ...g, saleLoading: false, saleMatch } : g
      ));
    }));
  };

  const buildGroceryList = () => {
    const planned = [];
    DAYS.forEach(day => {
      MEAL_TYPES.forEach(type => {
        const mealName = meals[day][type];
        if (mealName) {
          const recipe = recipes.find(r => r.name.toLowerCase() === mealName.toLowerCase());
          if (recipe) planned.push(...recipe.ingredients.map(i => i.replace(/^\d+[\d\/\s]*(cup|tbsp|tsp|oz|lb|g|can|clove|bunch|large|medium|small|fresh|dried|chopped|diced|minced|sliced)?s?\s*/i, "").trim()));
        }
      });
    });
    const unique = [...new Set(planned)].filter(Boolean).sort();
    const list = unique.map(item => {
      const sm = saleItems.find(s => item.toLowerCase().includes(s.item.toLowerCase()) || s.item.toLowerCase().includes(item.toLowerCase()));
      return { item, saleMatch: sm ? { store: sm.store, price: sm.price, item } : null, id: item };
    });
    const manual = groceryList.filter(g => g.manual);
    setGroceryList([...list, ...manual]);
    setActiveTab("grocery");
  };

  const addSaleItem = () => {
    if (!newSale.item) return;
    setSaleItems([...saleItems, { ...newSale, id: Date.now() }]);
    setNewSale({ item: "", store: "Publix", price: "", note: "" });
  };

  const addManualGrocery = () => {
    setGroceryList(prev => [...prev, { item: "", manual: true, editing: true, saleMatch: null, id: Date.now() }]);
  };

  const setMeal = (day, type, value) => setMeals(prev => ({ ...prev, [day]: { ...prev[day], [type]: value } }));

  const addRecipeManual = () => {
    if (!newRecipe.name) return;
    setRecipes([...recipes, {
      name: newRecipe.name,
      tags: newRecipe.tags.split(",").map(t => t.trim()).filter(Boolean),
      ingredients: newRecipe.ingredients.split(",").map(i => i.trim()).filter(Boolean),
      url: null,
    }]);
    setNewRecipe({ name: "", tags: "", ingredients: "" });
  };

  const filteredRecipes = recipes.filter(r =>
    !recipeFilter || r.name.toLowerCase().includes(recipeFilter.toLowerCase()) ||
    r.tags?.some(t => t.toLowerCase().includes(recipeFilter.toLowerCase())) ||
    r.ingredients?.some(i => i.toLowerCase().includes(recipeFilter.toLowerCase()))
  );

  const totalMealsPlanned = DAYS.reduce((acc, d) => acc + MEAL_TYPES.filter(t => meals[d][t]).length, 0);
  const saleGroceries = groceryList.filter(g => g.saleMatch);
  const storeSaleGroups = STORES.filter(s => saleGroceries.some(g => g.saleMatch?.store === s));

  const dietaryLabel = household.dietary.length > 0 ? household.dietary.join(", ") : "no restrictions";

  if (setup) return (
    <div style={{ fontFamily: "'Georgia', serif", background: "#faf8f4", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "white", borderRadius: 16, padding: 40, maxWidth: 480, width: "100%", boxShadow: "0 4px 24px rgba(0,0,0,0.10)" }}>
        <div style={{ color: "#3d6b4f", fontSize: 13, letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>Welcome to</div>
        <div style={{ fontSize: 26, fontWeight: "bold", marginBottom: 6 }}>Meal Planner</div>
        <div style={{ fontSize: 14, color: "#888", marginBottom: 28 }}>Let's get set up. You can change these any time.</div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 5 }}>What should we call you? (optional)</label>
          <input value={setupDraft.name} onChange={e => setSetupDraft(p => ({...p, name: e.target.value}))} placeholder="e.g. The Garcias, Sarah, Our House"
            style={{ width: "100%", border: "1px solid #ddd", borderRadius: 8, padding: "10px 12px", fontSize: 14, boxSizing: "border-box" }} />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 5 }}>How many people are you shopping for?</label>
          <select value={setupDraft.size} onChange={e => setSetupDraft(p => ({...p, size: e.target.value}))}
            style={{ width: "100%", border: "1px solid #ddd", borderRadius: 8, padding: "10px 12px", fontSize: 14 }}>
            {["1","2","3","4","5","6","7","8+"].map(n => <option key={n} value={n}>{n} {n === "1" ? "person" : "people"}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 28 }}>
          <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 8 }}>Any dietary preferences? (select all that apply)</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {DIETARY_OPTIONS.map(d => {
              const sel = setupDraft.dietary.includes(d);
              return <button key={d} onClick={() => setSetupDraft(p => ({ ...p, dietary: sel ? p.dietary.filter(x => x !== d) : [...p.dietary, d] }))}
                style={{ padding: "6px 14px", borderRadius: 20, border: sel ? "2px solid #3d6b4f" : "1px solid #ddd", background: sel ? "#e8f5e9" : "white", color: sel ? "#2d6a4f" : "#555", fontSize: 13, cursor: "pointer", fontWeight: sel ? "bold" : "normal" }}>{d}</button>;
            })}
          </div>
        </div>
        <button onClick={() => { setHousehold(setupDraft); setSetup(false); }}
          style={{ width: "100%", background: "#3d6b4f", color: "white", border: "none", borderRadius: 8, padding: "12px", fontSize: 15, cursor: "pointer", fontWeight: "bold" }}>
          Start planning →
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ fontFamily: "'Georgia', serif", background: "#faf8f4", minHeight: "100vh", color: "#2a2a2a" }}>
      {showSettings && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "white", borderRadius: 16, padding: 32, maxWidth: 440, width: "100%", boxShadow: "0 4px 24px rgba(0,0,0,0.15)" }}>
            <div style={{ fontSize: 18, fontWeight: "bold", marginBottom: 20 }}>Household settings</div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 5 }}>Name</label>
              <input value={setupDraft.name} onChange={e => setSetupDraft(p => ({...p, name: e.target.value}))} placeholder="e.g. The Garcias"
                style={{ width: "100%", border: "1px solid #ddd", borderRadius: 8, padding: "9px 12px", fontSize: 14, boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 5 }}>People</label>
              <select value={setupDraft.size} onChange={e => setSetupDraft(p => ({...p, size: e.target.value}))}
                style={{ width: "100%", border: "1px solid #ddd", borderRadius: 8, padding: "9px 12px", fontSize: 14 }}>
                {["1","2","3","4","5","6","7","8+"].map(n => <option key={n} value={n}>{n} {n === "1" ? "person" : "people"}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 8 }}>Dietary preferences</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {DIETARY_OPTIONS.map(d => {
                  const sel = setupDraft.dietary.includes(d);
                  return <button key={d} onClick={() => setSetupDraft(p => ({ ...p, dietary: sel ? p.dietary.filter(x => x !== d) : [...p.dietary, d] }))}
                    style={{ padding: "5px 12px", borderRadius: 20, border: sel ? "2px solid #3d6b4f" : "1px solid #ddd", background: sel ? "#e8f5e9" : "white", color: sel ? "#2d6a4f" : "#555", fontSize: 12, cursor: "pointer" }}>{d}</button>;
                })}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowSettings(false)} style={{ flex: 1, background: "white", color: "#666", border: "1px solid #ddd", borderRadius: 8, padding: "10px", fontSize: 14, cursor: "pointer" }}>Cancel</button>
              <button onClick={() => { setHousehold(setupDraft); setShowSettings(false); }} style={{ flex: 2, background: "#3d6b4f", color: "white", border: "none", borderRadius: 8, padding: "10px", fontSize: 14, cursor: "pointer", fontWeight: "bold" }}>Save</button>
            </div>
          </div>
        </div>
      )}
      <div style={{ background: "#3d6b4f", padding: "20px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ color: "#c8e6c9", fontSize: 12, letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>Weekly</div>
          <div style={{ color: "white", fontSize: 22, fontWeight: "bold" }}>{household.name ? `${household.name}'s Meal Planner` : "Meal Planner"}</div>
          <div style={{ color: "#a5d6a7", fontSize: 12, marginTop: 2 }}>{household.dietary.length > 0 ? household.dietary.join(" · ") : "All diets"} · {household.size === "1" ? "1 person" : `${household.size} people`}</div>
        </div>
        <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <div style={{ color: "#c8e6c9", fontSize: 12 }}>{totalMealsPlanned} meals planned</div>
          <div style={{ color: "#a5d6a7", fontSize: 11 }}>{recipes.length} recipes · {saleItems.length} sale items</div>
          <button onClick={() => { setSetupDraft({...household}); setShowSettings(true); }} style={{ background: "none", border: "1px solid #4a8a63", borderRadius: 5, color: "#a5d6a7", fontSize: 11, cursor: "pointer", padding: "2px 8px", marginTop: 2 }}>⚙ Household settings</button>
        </div>
      </div>

      <div style={{ display: "flex", background: "#2d5040", padding: "0 28px" }}>
        {[["plan","📅 Plan"],["sales","🏷️ Sales"],["recipes","📖 Recipes"],["grocery","🛒 Grocery List"]].map(([id, label]) => (
          <button key={id} onClick={() => setActiveTab(id)} style={{
            background: "none", border: "none", padding: "10px 16px",
            color: activeTab === id ? "white" : "#88b899",
            borderBottom: activeTab === id ? "2px solid #81c784" : "2px solid transparent",
            cursor: "pointer", fontSize: 13, fontFamily: "Georgia, serif",
          }}>{label}</button>
        ))}
      </div>

      <div style={{ padding: "24px 28px", maxWidth: 960, margin: "0 auto" }}>

        {/* ── PLAN ── */}
        {activeTab === "plan" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 14, color: "#666" }}>Click any slot to pick a recipe</div>
              <button onClick={buildGroceryList} style={{ background: "#3d6b4f", color: "white", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontSize: 13 }}>Build Grocery List →</button>
            </div>
            {saleItems.length > 0 && (
              <div style={{ background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12 }}>
                <strong style={{ color: "#2d6a4f" }}>On sale:</strong>{" "}
                {saleItems.map(s => <span key={s.id} style={{ marginRight: 10 }}><span style={{ color: SALE_COLORS[s.store], fontWeight: "bold" }}>{s.item}</span>{s.price && <span style={{ color: "#555" }}> ({s.price})</span>} <span style={{ color: "#888", fontSize: 11 }}>@{s.store}</span></span>)}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
              {DAYS.map(day => (
                <div key={day} style={{ background: "white", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
                  <div style={{ background: "#3d6b4f", color: "white", padding: "8px 12px", fontSize: 13, fontWeight: "bold" }}>{day}</div>
                  {MEAL_TYPES.map(type => (
                    <div key={type} style={{ padding: "8px 12px", borderBottom: type !== "Dinner" ? "1px solid #f0ede8" : "none" }}>
                      <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>{type}</div>
                      {showRecipePicker?.day === day && showRecipePicker?.type === type ? (
                        <div>
                          <input autoFocus placeholder="Search..." value={recipeFilter} onChange={e => setRecipeFilter(e.target.value)}
                            style={{ width: "100%", border: "1px solid #ddd", borderRadius: 4, padding: "4px 6px", fontSize: 12, boxSizing: "border-box" }} />
                          <div style={{ maxHeight: 130, overflowY: "auto", marginTop: 4 }}>
                            {filteredRecipes.map(r => (
                              <div key={r.name} onClick={() => { setMeal(day, type, r.name); setShowRecipePicker(null); setRecipeFilter(""); }}
                                style={{ padding: "4px 6px", cursor: "pointer", fontSize: 12, borderRadius: 3, color: "#2d5040" }}
                                onMouseOver={e => e.currentTarget.style.background = "#e8f5e9"}
                                onMouseOut={e => e.currentTarget.style.background = "none"}>
                                {r.name}
                              </div>
                            ))}
                          </div>
                          <button onClick={() => { setShowRecipePicker(null); setRecipeFilter(""); }} style={{ fontSize: 10, color: "#888", background: "none", border: "none", cursor: "pointer", marginTop: 2 }}>cancel</button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <div onClick={() => { setShowRecipePicker({ day, type }); setRecipeFilter(""); }}
                            style={{ flex: 1, fontSize: 12, color: meals[day][type] ? "#2a2a2a" : "#bbb", cursor: "pointer", minHeight: 20, fontStyle: meals[day][type] ? "normal" : "italic" }}>
                            {meals[day][type] || "Add meal..."}
                          </div>
                          {meals[day][type] && <button onClick={() => setMeal(day, type, "")} style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 14, padding: 0 }}>×</button>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── SALES ── */}
        {activeTab === "sales" && (
          <div>
            <div style={{ fontSize: 14, color: "#666", marginBottom: 16 }}>Track what's on sale before planning</div>
            <div style={{ background: "white", borderRadius: 10, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", marginBottom: 20 }}>
              <div style={{ fontWeight: "bold", marginBottom: 12, fontSize: 14, color: "#3d6b4f" }}>Add a sale item</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 8, alignItems: "end" }}>
                {[["item","Item","e.g. cherry tomatoes"],["price","Price / Deal","e.g. $1.99/lb"],["note","Note","optional"]].map(([field, label, ph]) => (
                  <div key={field}><div style={{ fontSize: 11, color: "#888", marginBottom: 3 }}>{label}</div>
                    <input value={newSale[field]} onChange={e => setNewSale({ ...newSale, [field]: e.target.value })} placeholder={ph}
                      style={{ width: "100%", border: "1px solid #ddd", borderRadius: 6, padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} /></div>
                ))}
                <div><div style={{ fontSize: 11, color: "#888", marginBottom: 3 }}>Store</div>
                  <select value={newSale.store} onChange={e => setNewSale({ ...newSale, store: e.target.value })}
                    style={{ width: "100%", border: "1px solid #ddd", borderRadius: 6, padding: "7px 10px", fontSize: 13 }}>
                    {STORES.map(s => <option key={s}>{s}</option>)}
                  </select></div>
                <button onClick={addSaleItem} style={{ background: "#3d6b4f", color: "white", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontSize: 13 }}>Add</button>
              </div>
            </div>
            {STORES.filter(s => saleItems.some(i => i.store === s)).map(store => (
              <div key={store} style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: "bold", color: SALE_COLORS[store], fontSize: 13, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>{store}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {saleItems.filter(i => i.store === store).map(item => (
                    <div key={item.id} style={{ background: "white", border: `1px solid ${SALE_COLORS[store]}40`, borderRadius: 8, padding: "8px 12px", fontSize: 13, position: "relative" }}>
                      <div style={{ fontWeight: "bold" }}>{item.item}</div>
                      {item.price && <div style={{ color: SALE_COLORS[store], fontSize: 12 }}>{item.price}</div>}
                      {item.note && <div style={{ color: "#888", fontSize: 11 }}>{item.note}</div>}
                      <button onClick={() => setSaleItems(saleItems.filter(i => i.id !== item.id))}
                        style={{ position: "absolute", top: 4, right: 6, background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 14 }}>×</button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {saleItems.length === 0 && <div style={{ color: "#aaa", fontStyle: "italic", fontSize: 14 }}>No sale items yet.</div>}
          </div>
        )}

        {/* ── RECIPES ── */}
        {activeTab === "recipes" && (
          <div>
            {/* URL import */}
            <div style={{ background: "white", borderRadius: 10, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", marginBottom: 20, border: "1px solid #e8f5e9" }}>
              <div style={{ fontWeight: "bold", fontSize: 14, color: "#3d6b4f", marginBottom: 8 }}>📎 Import recipe from URL</div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 10 }}>Paste any recipe link — it'll extract the name, ingredients, and tags automatically, and save the link so you can find it again.</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={urlInput} onChange={e => setUrlInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") addFromUrl(); }}
                  placeholder="https://www.budgetbytes.com/your-recipe..."
                  style={{ flex: 1, border: "1px solid #ddd", borderRadius: 6, padding: "8px 12px", fontSize: 13 }} />
                <button onClick={addFromUrl} disabled={urlLoading}
                  style={{ background: urlLoading ? "#aaa" : "#3d6b4f", color: "white", border: "none", borderRadius: 6, padding: "8px 18px", cursor: urlLoading ? "default" : "pointer", fontSize: 13, whiteSpace: "nowrap" }}>
                  {urlLoading ? "Importing..." : "Import"}
                </button>
              </div>
              {urlError && <div style={{ marginTop: 8, fontSize: 12, color: "#c0392b" }}>{urlError}</div>}
            </div>

            <div style={{ marginBottom: 16, display: "flex", gap: 10, alignItems: "center" }}>
              <input value={recipeFilter} onChange={e => setRecipeFilter(e.target.value)} placeholder="Search by name, tag, or ingredient..."
                style={{ flex: 1, border: "1px solid #ddd", borderRadius: 8, padding: "8px 12px", fontSize: 14 }} />
              <span style={{ color: "#888", fontSize: 13 }}>{filteredRecipes.length} recipes</span>
            </div>

            <details style={{ marginBottom: 20 }}>
              <summary style={{ cursor: "pointer", color: "#3d6b4f", fontSize: 14, fontWeight: "bold", padding: "10px 0" }}>+ Add recipe manually</summary>
              <div style={{ background: "white", borderRadius: 10, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", marginTop: 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <div><div style={{ fontSize: 11, color: "#888", marginBottom: 3 }}>Recipe name</div>
                    <input value={newRecipe.name} onChange={e => setNewRecipe({ ...newRecipe, name: e.target.value })} placeholder="e.g. Veggie Enchiladas"
                      style={{ width: "100%", border: "1px solid #ddd", borderRadius: 6, padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} /></div>
                  <div><div style={{ fontSize: 11, color: "#888", marginBottom: 3 }}>Tags (comma-separated)</div>
                    <input value={newRecipe.tags} onChange={e => setNewRecipe({ ...newRecipe, tags: e.target.value })} placeholder="quick, family-friendly"
                      style={{ width: "100%", border: "1px solid #ddd", borderRadius: 6, padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} /></div>
                </div>
                <div style={{ marginBottom: 12 }}><div style={{ fontSize: 11, color: "#888", marginBottom: 3 }}>Ingredients (comma-separated)</div>
                  <input value={newRecipe.ingredients} onChange={e => setNewRecipe({ ...newRecipe, ingredients: e.target.value })} placeholder="black beans, tortillas, cheese"
                    style={{ width: "100%", border: "1px solid #ddd", borderRadius: 6, padding: "7px 10px", fontSize: 13, boxSizing: "border-box" }} /></div>
                <button onClick={addRecipeManual} style={{ background: "#3d6b4f", color: "white", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontSize: 13 }}>Save Recipe</button>
              </div>
            </details>

            {/* Recipe cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
              {filteredRecipes.map(r => {
                const saleMatches = r.ingredients?.filter(ing =>
                  saleItems.some(s => ing.toLowerCase().includes(s.item.toLowerCase()) || s.item.toLowerCase().includes(ing.toLowerCase()))
                ) || [];
                const isExpanded = expandedRecipe === r.name;
                return (
                  <div key={r.name} style={{ background: "white", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", overflow: "hidden", border: isExpanded ? "1px solid #a5d6a7" : "1px solid transparent" }}>
                    <div style={{ padding: "14px 14px 10px", cursor: "pointer" }} onClick={() => setExpandedRecipe(isExpanded ? null : r.name)}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                        <div style={{ fontWeight: "bold", fontSize: 14, flex: 1, paddingRight: 8 }}>{r.name}</div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                          {saleMatches.length > 0 && <span style={{ background: "#e8f5e9", color: "#2d6a4f", fontSize: 10, fontWeight: "bold", borderRadius: 10, padding: "2px 7px" }}>{saleMatches.length} on sale</span>}
                          {r.url && <span style={{ fontSize: 12 }} title="Has source link">🔗</span>}
                          <span style={{ color: "#aaa", fontSize: 12 }}>{isExpanded ? "▲" : "▼"}</span>
                        </div>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                        {r.tags?.map(t => <span key={t} style={{ fontSize: 10, background: "#f0ede8", color: "#666", borderRadius: 10, padding: "2px 8px" }}>{t}</span>)}
                      </div>
                      {r.description && <div style={{ fontSize: 12, color: "#888", fontStyle: "italic", marginBottom: 4 }}>{r.description}</div>}
                      {(r.time || r.servings) && (
                        <div style={{ fontSize: 11, color: "#aaa" }}>
                          {r.time && <span>⏱ {r.time}</span>}
                          {r.time && r.servings && <span style={{ margin: "0 6px" }}>·</span>}
                          {r.servings && <span>👥 {r.servings}</span>}
                        </div>
                      )}
                    </div>

                    {isExpanded && (
                      <div style={{ borderTop: "1px solid #f0ede8", padding: "12px 14px" }}>
                        <div style={{ fontSize: 12, fontWeight: "bold", color: "#3d6b4f", marginBottom: 6 }}>Ingredients</div>
                        <div style={{ marginBottom: 12 }}>
                          {r.ingredients?.map(ing => {
                            const onSale = saleItems.some(s => ing.toLowerCase().includes(s.item.toLowerCase()) || s.item.toLowerCase().includes(ing.toLowerCase()));
                            return (
                              <div key={ing} style={{ fontSize: 12, padding: "2px 0", color: onSale ? "#2d6a4f" : "#444", fontWeight: onSale ? "bold" : "normal" }}>
                                {onSale ? "✓ " : "• "}{ing}
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button onClick={() => addToGroceryList(r)} style={{ background: "#3d6b4f", color: "white", border: "none", borderRadius: 6, padding: "7px 14px", cursor: "pointer", fontSize: 12 }}>
                            + Add ingredients to grocery list
                          </button>
                          {r.url && (
                            <a href={r.url} target="_blank" rel="noopener noreferrer"
                              style={{ background: "white", color: "#3d6b4f", border: "1px solid #3d6b4f", borderRadius: 6, padding: "7px 14px", fontSize: 12, textDecoration: "none", display: "inline-block" }}>
                              View original recipe ↗
                            </a>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── GROCERY ── */}
        {activeTab === "grocery" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 14, color: "#666" }}>
                {groceryList.length > 0 ? `${groceryList.filter(i => !checkedItems[i.item]).length} items remaining` : "Add recipes or build from your plan"}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={addManualGrocery} style={{ background: "white", color: "#3d6b4f", border: "1px solid #3d6b4f", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 13 }}>+ Add item</button>
                <button onClick={() => setCheckedItems({})} style={{ background: "none", color: "#aaa", border: "none", cursor: "pointer", fontSize: 13 }}>Clear checks</button>
                <button onClick={() => setGroceryList([])} style={{ background: "none", color: "#e57373", border: "none", cursor: "pointer", fontSize: 13 }}>Clear list</button>
              </div>
            </div>

            {groceryList.some(g => g.saleLoading) && (
              <div style={{ background: "#e8f0fe", border: "1px solid #c5d8f0", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: "#3c5a8a" }}>
                🔍 Checking sales at Publix, Target, Walmart & Whole Foods for your ingredients...
              </div>
            )}

            {storeSaleGroups.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontWeight: "bold", fontSize: 13, color: "#3d6b4f", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>🏷️ Buy on sale</div>
                {storeSaleGroups.map(store => (
                  <div key={store} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: "bold", color: SALE_COLORS[store], marginBottom: 4 }}>{store}</div>
                    {saleGroceries.filter(g => g.saleMatch?.store === store).map(g => (
                      <GroceryItem key={g.id || g.item} item={g} checked={checkedItems[g.item]}
                        onCheck={() => setCheckedItems(p => ({ ...p, [g.item]: !p[g.item] }))}
                        highlight saleItems={saleItems} />
                    ))}
                  </div>
                ))}
              </div>
            )}

            {groceryList.filter(g => !g.saleMatch).length > 0 && (
              <div>
                <div style={{ fontWeight: "bold", fontSize: 13, color: "#666", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Everything else</div>
                {groceryList.filter(g => !g.saleMatch).map(g => (
                  <GroceryItem key={g.id || g.item} item={g} checked={checkedItems[g.item]}
                    onCheck={() => setCheckedItems(p => ({ ...p, [g.item]: !p[g.item] }))}
                    saleItems={saleItems}
                    onSaleFound={(saleMatch) => setGroceryList(prev => prev.map(i => i.id === g.id ? { ...i, saleMatch } : i))}
                    onEdit={(newVal, saleMatch) => setGroceryList(prev => prev.map(i => i.id === g.id ? { ...i, item: newVal, editing: false, saleMatch: saleMatch || null } : i))} />
                ))}
              </div>
            )}

            {groceryList.length === 0 && (
              <div style={{ color: "#aaa", fontStyle: "italic", fontSize: 14, textAlign: "center", marginTop: 40 }}>
                Import a recipe in the Recipes tab, or plan your meals and click "Build Grocery List."
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function GroceryItem({ item, checked, onCheck, onEdit, onSaleFound, highlight, saleItems = [] }) {
  const [editing, setEditing] = useState(item.editing || false);
  const [val, setVal] = useState(item.item || "");
  const [lookupState, setLookupState] = useState("idle");
  const [aiSaleMatches, setAiSaleMatches] = useState([]);
  const debounceRef = useRef(null);

  const loggedSaleMatch = val
    ? saleItems.find(s => val.toLowerCase().includes(s.item.toLowerCase()) || s.item.toLowerCase().includes(val.toLowerCase()))
    : null;

  useEffect(() => {
    if (!editing || val.length < 3) { setAiSaleMatches([]); setLookupState("idle"); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLookupState("searching");
      const results = await lookupSales(val);
      setAiSaleMatches(results);
      setLookupState("done");
      if (results.length > 0 && onSaleFound) onSaleFound({ store: results[0].store, price: results[0].price, note: results[0].note, item: val });
    }, 800);
    return () => clearTimeout(debounceRef.current);
  }, [val, editing]);

  const bestMatch = loggedSaleMatch || (aiSaleMatches.length > 0 ? { store: aiSaleMatches[0].store, price: aiSaleMatches[0].price, item: val } : null);
  const displaySaleMatch = item.saleMatch || bestMatch;

  const handleCommit = () => { onEdit && onEdit(val, bestMatch || null); setEditing(false); };

  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 12px",
      background: checked ? "#f9f9f9" : "white", borderRadius: 8, marginBottom: 6,
      boxShadow: "0 1px 3px rgba(0,0,0,0.06)", opacity: checked ? 0.5 : 1,
      border: (loggedSaleMatch || aiSaleMatches.length > 0) && editing ? "1px solid #a5d6a7" : "1px solid transparent",
    }}>
      <input type="checkbox" checked={!!checked} onChange={onCheck}
        style={{ accentColor: "#3d6b4f", width: 16, height: 16, cursor: "pointer", flexShrink: 0, marginTop: 3 }} />
      {item.saleLoading ? (
        <span style={{ flex: 1, fontSize: 13, color: "#888", fontStyle: "italic" }}>{item.item} <span style={{ fontSize: 11 }}>— checking sales...</span></span>
      ) : editing ? (
        <div style={{ flex: 1 }}>
          <input autoFocus value={val} onChange={e => setVal(e.target.value)} onBlur={handleCommit}
            onKeyDown={e => { if (e.key === "Enter") handleCommit(); }}
            placeholder="e.g. broccoli, eggs, pasta..."
            style={{ width: "100%", border: "1px solid #ddd", borderRadius: 4, padding: "4px 8px", fontSize: 13, boxSizing: "border-box" }} />
          {val.length >= 3 && (
            <div style={{ marginTop: 4 }}>
              {lookupState === "searching" && <div style={{ fontSize: 11, color: "#888", fontStyle: "italic" }}>🔍 Checking stores...</div>}
              {loggedSaleMatch && <div style={{ fontSize: 11, color: SALE_COLORS[loggedSaleMatch.store] || "#3d6b4f", fontWeight: "bold" }}>🏷️ In your logged sales @{loggedSaleMatch.store}{loggedSaleMatch.price && ` · ${loggedSaleMatch.price}`}</div>}
              {!loggedSaleMatch && lookupState === "done" && aiSaleMatches.map((m, i) => (
                <div key={i} style={{ fontSize: 11, color: SALE_COLORS[m.store] || "#3d6b4f", fontWeight: "bold" }}>🏷️ On sale @{m.store}{m.price && ` · ${m.price}`}{m.note && ` · ${m.note}`}</div>
              ))}
              {!loggedSaleMatch && lookupState === "done" && aiSaleMatches.length === 0 && <div style={{ fontSize: 11, color: "#aaa" }}>No current sales found.</div>}
            </div>
          )}
        </div>
      ) : (
        <span style={{ flex: 1, fontSize: 13, textDecoration: checked ? "line-through" : "none", color: highlight || displaySaleMatch ? "#2d6a4f" : "#2a2a2a", fontWeight: highlight || displaySaleMatch ? "bold" : "normal", cursor: "pointer" }}
          onClick={() => setEditing(true)}>
          {item.item || <span style={{ color: "#ccc", fontStyle: "italic" }}>Click to name item</span>}
          {item.fromRecipe && <span style={{ fontSize: 10, color: "#aaa", marginLeft: 6, fontWeight: "normal" }}>from {item.fromRecipe}</span>}
          {displaySaleMatch && <span style={{ marginLeft: 8, fontSize: 11, color: SALE_COLORS[displaySaleMatch.store] || "#3d6b4f", fontWeight: "normal" }}>on sale @{displaySaleMatch.store}{displaySaleMatch.price && ` · ${displaySaleMatch.price}`}</span>}
        </span>
      )}
    </div>
  );
}
